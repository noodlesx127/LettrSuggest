/**
 * Quiz Learning System
 * Generates quiz questions and processes answers to strengthen preference learning
 */

import { supabase } from './supabaseClient';
import { detectSubgenres, stringHash } from './subgenreDetection';

// Types - Extended with new question types
export type QuizQuestionType =
    | 'genre_rating'
    | 'theme_preference'
    | 'movie_rating'
    | 'subgenre_preference'
    | 'actor_preference'
    | 'director_preference'
    | 'era_preference'
    | 'pairwise';

export interface GenreRatingQuestion {
    type: 'genre_rating';
    genreId: number;
    genreName: string;
}

export interface ThemePreferenceQuestion {
    type: 'theme_preference';
    keywordId: number;
    keywordName: string;
}

export interface MovieRatingQuestion {
    type: 'movie_rating';
    tmdbId: number;
    title: string;
    year?: string;
    posterPath?: string | null;
    overview?: string;
    genres?: string[];
    trailerKey?: string | null;
    consensusLevel?: string;
}

// NEW: Subgenre preference question
export interface SubgenrePreferenceQuestion {
    type: 'subgenre_preference';
    subgenreKey: string;      // e.g., 'HORROR_FOLK'
    subgenreName: string;     // e.g., 'Folk Horror'
    parentGenreName: string;  // e.g., 'Horror'
}

// NEW: Actor preference question
export interface ActorPreferenceQuestion {
    type: 'actor_preference';
    actorId: number;
    actorName: string;
    knownFor?: string;  // e.g., "The Dark Knight, Inception"
}

// NEW: Director preference question
export interface DirectorPreferenceQuestion {
    type: 'director_preference';
    directorId: number;
    directorName: string;
    knownFor?: string;
}

// NEW: Era/Decade preference question
export interface EraPreferenceQuestion {
    type: 'era_preference';
    decade: number;          // e.g., 1980
    eraName: string;         // e.g., "1980s"
    eraDescription: string;  // e.g., "Practical effects, synth soundtracks"
}

// NEW: Pairwise comparison question
export interface PairwiseQuestion {
    type: 'pairwise';
    movieA: MovieRatingQuestion;
    movieB: MovieRatingQuestion;
}

export type QuizQuestion =
    | GenreRatingQuestion
    | ThemePreferenceQuestion
    | MovieRatingQuestion
    | SubgenrePreferenceQuestion
    | ActorPreferenceQuestion
    | DirectorPreferenceQuestion
    | EraPreferenceQuestion
    | PairwiseQuestion;

export interface GenreRatingAnswer {
    rating: 1 | 2 | 3 | 4 | 5; // 1=Never, 2=Rarely, 3=Sometimes, 4=Often, 5=Love it
}

export interface ThemePreferenceAnswer {
    preference: 'yes' | 'maybe' | 'no';
}

export interface MovieRatingAnswer {
    thumbsUp: boolean;
}

// NEW: Subgenre answer (same as theme preference)
export interface SubgenrePreferenceAnswer {
    preference: 'love' | 'like' | 'neutral' | 'dislike';
}

// NEW: Person preference answer
export interface PersonPreferenceAnswer {
    preference: 'fan' | 'neutral' | 'avoid';
}

// NEW: Era preference answer
export interface EraPreferenceAnswer {
    preference: 'love' | 'like' | 'neutral' | 'dislike';
}

// NEW: Pairwise answer
export interface PairwiseAnswer {
    winnerId: number;
    loserId: number;
}

export type QuizAnswer =
    | GenreRatingAnswer
    | ThemePreferenceAnswer
    | MovieRatingAnswer
    | SubgenrePreferenceAnswer
    | PersonPreferenceAnswer
    | EraPreferenceAnswer
    | PairwiseAnswer;

// Genre list for quiz questions (TMDB genre IDs)
const QUIZ_GENRES = [
    { id: 28, name: 'Action' },
    { id: 12, name: 'Adventure' },
    { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' },
    { id: 80, name: 'Crime' },
    { id: 99, name: 'Documentary' },
    { id: 18, name: 'Drama' },
    { id: 10751, name: 'Family' },
    { id: 14, name: 'Fantasy' },
    { id: 36, name: 'History' },
    { id: 27, name: 'Horror' },
    { id: 10402, name: 'Music' },
    { id: 9648, name: 'Mystery' },
    { id: 10749, name: 'Romance' },
    { id: 878, name: 'Science Fiction' },
    { id: 53, name: 'Thriller' },
    { id: 10752, name: 'War' },
    { id: 37, name: 'Western' },
];

// Common keywords/themes for quiz questions - MASSIVELY EXPANDED (150+ keywords)
const QUIZ_KEYWORDS = [
    // ==== CLASSIC THEMES (Original 37) ====
    { id: 9715, name: 'superhero' },
    { id: 4344, name: 'musical' },
    { id: 10349, name: 'survival' },
    { id: 6149, name: 'dystopia' },
    { id: 310, name: 'artificial intelligence' },
    { id: 9882, name: 'space' },
    { id: 12332, name: 'zombie' },
    { id: 3691, name: 'forbidden love' },
    { id: 9663, name: 'time travel' },
    { id: 849, name: 'vampire' },
    { id: 162846, name: 'serial killer' },
    { id: 10224, name: 'heist' },
    { id: 11322, name: 'female protagonist' },
    { id: 818, name: 'based on novel' },
    { id: 10683, name: 'coming of age' },
    { id: 1568, name: 'underdog' },
    { id: 4565, name: 'anti-hero' },
    { id: 1430, name: 'conspiracy' },
    { id: 11332, name: 'martial arts' },
    { id: 1454, name: 'world war ii' },
    { id: 4379, name: 'remake' },
    { id: 9748, name: 'revenge' },
    { id: 207317, name: 'christmas' },
    { id: 10714, name: 'road trip' },
    { id: 3799, name: 'spy' },
    { id: 1328, name: 'haunted house' },
    { id: 158718, name: 'found footage' },
    { id: 9672, name: 'based on true story' },
    { id: 9986, name: 'solo mission' },
    { id: 1562, name: 'disaster' },
    { id: 6054, name: 'father son relationship' },
    { id: 10235, name: 'ensemble cast' },
    { id: 3929, name: 'independent film' },
    { id: 1299, name: 'monster' },
    { id: 157430, name: 'dark comedy' },

    // ==== SETTINGS & LOCATIONS ====
    { id: 1844, name: 'prison' },
    { id: 10084, name: 'new york' },
    { id: 1382, name: 'los angeles' },
    { id: 187056, name: 'las vegas' },
    { id: 4613, name: 'small town' },
    { id: 6917, name: 'island' },
    { id: 12988, name: 'jungle' },
    { id: 10289, name: 'ocean' },
    { id: 1826, name: 'desert' },
    { id: 9692, name: 'space station' },
    { id: 14643, name: 'underwater' },
    { id: 2052, name: 'haunted' },
    { id: 15101, name: 'parallel universe' },
    { id: 10891, name: 'high school' },
    { id: 207928, name: 'college' },
    { id: 12565, name: 'hospital' },
    { id: 14639, name: 'suburbia' },

    // ==== STORY ELEMENTS ====
    { id: 9673, name: 'twist ending' },
    { id: 10873, name: 'buddy cop' },
    { id: 5565, name: 'biography' },
    { id: 1631, name: 'race against time' },
    { id: 233, name: 'treasure hunt' },
    { id: 9916, name: 'amnesia' },
    { id: 3650, name: 'double cross' },
    { id: 10714, name: 'chase' },
    { id: 2910, name: 'rescue mission' },
    { id: 6077, name: 'love triangle' },
    { id: 209117, name: 'unreliable narrator' },
    { id: 15058, name: 'mistaken identity' },
    { id: 161176, name: 'chosen one' },
    { id: 9755, name: 'parody' },
    { id: 3616, name: 'fish out of water' },
    { id: 11057, name: 'midlife crisis' },
    { id: 10617, name: 'forbidden fruit' },
    { id: 10959, name: 'star-crossed lovers' },

    // ==== CHARACTER TYPES ====
    { id: 14552, name: 'assassin' },
    { id: 3085, name: 'bounty hunter' },
    { id: 14901, name: 'detective' },
    { id: 6029, name: 'soldier' },
    { id: 15157, name: 'scientist' },
    { id: 12309, name: 'outlaw' },
    { id: 10527, name: 'vigilante' },
    { id: 2623, name: 'gangster' },
    { id: 4424, name: 'psychopath' },
    { id: 12995, name: 'genius' },
    { id: 11081, name: 'werewolf' },
    { id: 14909, name: 'alien' },
    { id: 10061, name: 'ghost' },
    { id: 9714, name: 'robot' },
    { id: 156770, name: 'witch' },
    { id: 3205, name: 'pirate' },
    { id: 1293, name: 'samurai' },
    { id: 15145, name: 'ninja' },
    { id: 170362, name: 'hitman' },
    { id: 10149, name: 'cowboy' },

    // ==== EMOTIONS & TONE ====
    { id: 9717, name: 'feel good' },
    { id: 155430, name: 'tearjerker' },
    { id: 6054, name: 'heartwarming' },
    { id: 10850, name: 'suspenseful' },
    { id: 3741, name: 'sexy' },
    { id: 9729, name: 'inspirational' },
    { id: 6539, name: 'nostalgic' },
    { id: 156174, name: 'occult' },
    { id: 1965, name: 'mind-bending' },
    { id: 17015, name: 'mind control' },
    { id: 163053, name: 'atmospheric' },

    // ==== CONCEPTS & IDEAS ====
    { id: 3270, name: 'immortality' },
    { id: 402, name: 'cloning' },
    { id: 14601, name: 'virtual reality' },
    { id: 1449, name: 'apocalypse' },
    { id: 9951, name: 'alien contact' },
    { id: 4426, name: 'dream' },
    { id: 779, name: 'nuclear war' },
    { id: 14757, name: 'memory' },
    { id: 10085, name: 'multiverse' },
    { id: 16120, name: 'simulation' },
    { id: 174582, name: 'possession' },
    { id: 6992, name: 'cult' },
    { id: 1325, name: 'exorcism' },
    { id: 3766, name: 'cannibalism' },
    { id: 10370, name: 'drug addiction' },
    { id: 214780, name: 'courtroom' },
    { id: 14533, name: 'bank robbery' },
    { id: 9891, name: 'jewel theft' },
    { id: 10028, name: 'steampunk' },
    { id: 12190, name: 'cyberpunk' },

    // ==== RELATIONSHIPS ====
    { id: 161859, name: 'bromance' },
    { id: 156852, name: 'enemies to lovers' },
    { id: 15012, name: 'long-distance relationship' },
    { id: 9840, name: 'wedding' },
    { id: 11479, name: 'divorce' },
    { id: 155889, name: 'family drama' },
    { id: 10168, name: 'adoption' },
    { id: 11348, name: 'pregnancy' },
    { id: 12648, name: 'sibling rivalry' },

    // ==== BASED ON... ====
    { id: 9717, name: 'based on comic' },
    { id: 9716, name: 'based on video game' },
    { id: 207322, name: 'based on podcast' },
    { id: 10596, name: 'based on play' },
    { id: 155573, name: 'true crime' },
    { id: 2673, name: 'historical fiction' },
    { id: 287501, name: 'anime adaptation' },

    // ==== MORE SPECIFIC GENRES ====
    { id: 155387, name: 'mockumentary' },
    { id: 6930, name: 'stop motion' },
    { id: 10084, name: 'black and white' },
    { id: 11324, name: 'silent film' },
    { id: 4270, name: 'noir' },
    { id: 1942, name: 'exploitation' },
    { id: 10077, name: 'grindhouse' },
    { id: 14692, name: 'slasher' },
    { id: 191736, name: 'torture porn' },
    { id: 155574, name: 'eco-horror' },
];

// ==== SUBGENRES FOR DIRECT QUESTIONS ====
// Derived from subgenreData.ts - includes all major subgenres for direct preference queries
const QUIZ_SUBGENRES = [
    // HORROR subgenres
    { key: 'HORROR_SUPERNATURAL', name: 'Supernatural Horror', parent: 'Horror' },
    { key: 'HORROR_PSYCHOLOGICAL', name: 'Psychological Horror', parent: 'Horror' },
    { key: 'HORROR_SLASHER', name: 'Slasher Films', parent: 'Horror' },
    { key: 'HORROR_ZOMBIE', name: 'Zombie Horror', parent: 'Horror' },
    { key: 'HORROR_BODY', name: 'Body Horror', parent: 'Horror' },
    { key: 'HORROR_FOLK', name: 'Folk Horror', parent: 'Horror' },
    { key: 'HORROR_WITCH', name: 'Witch Films', parent: 'Horror' },
    { key: 'HORROR_COSMIC', name: 'Cosmic Horror', parent: 'Horror' },
    { key: 'HORROR_GOTHIC', name: 'Gothic Horror', parent: 'Horror' },
    { key: 'HORROR_FOUND_FOOTAGE', name: 'Found Footage Horror', parent: 'Horror' },
    { key: 'HORROR_MONSTER', name: 'Monster Movies', parent: 'Horror' },
    { key: 'HORROR_VAMPIRE', name: 'Vampire Films', parent: 'Horror' },
    { key: 'HORROR_WEREWOLF', name: 'Werewolf Films', parent: 'Horror' },
    { key: 'HORROR_COMEDY', name: 'Horror Comedy', parent: 'Horror' },
    { key: 'HORROR_EXTREME', name: 'Extreme Horror', parent: 'Horror' },
    { key: 'HORROR_GIALLO', name: 'Giallo', parent: 'Horror' },

    // THRILLER subgenres
    { key: 'THRILLER_PSYCHOLOGICAL', name: 'Psychological Thriller', parent: 'Thriller' },
    { key: 'THRILLER_CONSPIRACY', name: 'Conspiracy Thriller', parent: 'Thriller' },
    { key: 'THRILLER_CRIME', name: 'Crime Thriller', parent: 'Thriller' },
    { key: 'THRILLER_NEO_NOIR', name: 'Neo-Noir', parent: 'Thriller' },
    { key: 'THRILLER_LEGAL', name: 'Legal Thriller', parent: 'Thriller' },
    { key: 'THRILLER_POLITICAL', name: 'Political Thriller', parent: 'Thriller' },
    { key: 'THRILLER_SPY', name: 'Spy Thriller', parent: 'Thriller' },
    { key: 'THRILLER_REVENGE', name: 'Revenge Thriller', parent: 'Thriller' },
    { key: 'THRILLER_ACTION', name: 'Action Thriller', parent: 'Thriller' },

    // SCI-FI subgenres
    { key: 'SCIFI_SPACE', name: 'Space Exploration', parent: 'Science Fiction' },
    { key: 'SCIFI_CYBERPUNK', name: 'Cyberpunk', parent: 'Science Fiction' },
    { key: 'SCIFI_TIME_TRAVEL', name: 'Time Travel', parent: 'Science Fiction' },
    { key: 'SCIFI_ALIEN', name: 'Alien Films', parent: 'Science Fiction' },
    { key: 'SCIFI_POST_APOCALYPTIC', name: 'Post-Apocalyptic', parent: 'Science Fiction' },
    { key: 'SCIFI_DYSTOPIA', name: 'Dystopian Sci-Fi', parent: 'Science Fiction' },
    { key: 'SCIFI_SPACE_OPERA', name: 'Space Opera', parent: 'Science Fiction' },
    { key: 'SCIFI_STEAMPUNK', name: 'Steampunk', parent: 'Science Fiction' },
    { key: 'SCIFI_ROBOT', name: 'Robot/AI Films', parent: 'Science Fiction' },
    { key: 'SCIFI_KAIJU', name: 'Kaiju/Giant Monster', parent: 'Science Fiction' },
    { key: 'SCIFI_INVASION', name: 'Alien Invasion', parent: 'Science Fiction' },

    // DRAMA subgenres
    { key: 'DRAMA_PSYCHOLOGICAL', name: 'Psychological Drama', parent: 'Drama' },
    { key: 'DRAMA_ARTHOUSE', name: 'Art House Drama', parent: 'Drama' },
    { key: 'DRAMA_SLOW_BURN', name: 'Slow Burn Drama', parent: 'Drama' },
    { key: 'DRAMA_HISTORICAL', name: 'Historical Drama', parent: 'Drama' },
    { key: 'DRAMA_FAMILY', name: 'Family Drama', parent: 'Drama' },
    { key: 'DRAMA_COMING_OF_AGE', name: 'Coming-of-Age', parent: 'Drama' },
    { key: 'DRAMA_COURTROOM', name: 'Courtroom Drama', parent: 'Drama' },
    { key: 'DRAMA_SPORTS', name: 'Sports Drama', parent: 'Drama' },
    { key: 'DRAMA_WAR', name: 'War Drama', parent: 'Drama' },
    { key: 'DRAMA_BIOGRAPHICAL', name: 'Biographical Drama', parent: 'Drama' },
    { key: 'DRAMA_PRISON', name: 'Prison Drama', parent: 'Drama' },

    // COMEDY subgenres
    { key: 'COMEDY_ROMANTIC', name: 'Romantic Comedy', parent: 'Comedy' },
    { key: 'COMEDY_DARK', name: 'Dark Comedy', parent: 'Comedy' },
    { key: 'COMEDY_SATIRE', name: 'Satire', parent: 'Comedy' },
    { key: 'COMEDY_PARODY', name: 'Parody', parent: 'Comedy' },
    { key: 'COMEDY_SLAPSTICK', name: 'Slapstick Comedy', parent: 'Comedy' },
    { key: 'COMEDY_BUDDY', name: 'Buddy Comedy', parent: 'Comedy' },
    { key: 'COMEDY_STONER', name: 'Stoner Comedy', parent: 'Comedy' },
    { key: 'COMEDY_TEEN', name: 'Teen Comedy', parent: 'Comedy' },

    // ACTION subgenres
    { key: 'ACTION_MARTIAL_ARTS', name: 'Martial Arts', parent: 'Action' },
    { key: 'ACTION_SUPERHERO', name: 'Superhero Action', parent: 'Action' },
    { key: 'ACTION_MILITARY', name: 'Military Action', parent: 'Action' },
    { key: 'ACTION_SPY', name: 'Spy Action', parent: 'Action' },
    { key: 'ACTION_HEIST', name: 'Heist Films', parent: 'Action' },
    { key: 'ACTION_CAR', name: 'Car Chase Films', parent: 'Action' },

    // FANTASY subgenres
    { key: 'FANTASY_EPIC', name: 'Epic Fantasy', parent: 'Fantasy' },
    { key: 'FANTASY_DARK', name: 'Dark Fantasy', parent: 'Fantasy' },
    { key: 'FANTASY_URBAN', name: 'Urban Fantasy', parent: 'Fantasy' },
    { key: 'FANTASY_FAIRY_TALE', name: 'Fairy Tale', parent: 'Fantasy' },
    { key: 'FANTASY_SWORD_SORCERY', name: 'Sword & Sorcery', parent: 'Fantasy' },

    // DOCUMENTARY subgenres
    { key: 'DOC_TRUE_CRIME', name: 'True Crime Documentary', parent: 'Documentary' },
    { key: 'DOC_NATURE', name: 'Nature Documentary', parent: 'Documentary' },
    { key: 'DOC_MUSIC', name: 'Music Documentary', parent: 'Documentary' },
    { key: 'DOC_SPORTS', name: 'Sports Documentary', parent: 'Documentary' },
    { key: 'DOC_POLITICAL', name: 'Political Documentary', parent: 'Documentary' },
    { key: 'DOC_FOOD', name: 'Food Documentary', parent: 'Documentary' },
];

// ==== ERA/DECADE PREFERENCES ====
const QUIZ_ERAS = [
    { decade: 1920, name: '1920s', description: 'Silent film era, German Expressionism' },
    { decade: 1930, name: '1930s', description: 'Golden Age of Hollywood, Universal Monsters' },
    { decade: 1940, name: '1940s', description: 'Film noir, wartime cinema' },
    { decade: 1950, name: '1950s', description: 'Technicolor musicals, sci-fi B-movies' },
    { decade: 1960, name: '1960s', description: 'French New Wave, British Invasion' },
    { decade: 1970, name: '1970s', description: 'New Hollywood, gritty realism' },
    { decade: 1980, name: '1980s', description: 'Blockbusters, practical effects, synth scores' },
    { decade: 1990, name: '1990s', description: 'Indie boom, digital filmmaking begins' },
    { decade: 2000, name: '2000s', description: 'CGI revolution, franchise era' },
    { decade: 2010, name: '2010s', description: 'Streaming era, superhero dominance' },
    { decade: 2020, name: '2020s', description: 'Pandemic era, streaming originals' },
];

// ==== POPULAR ACTORS FOR QUESTIONS ====
// These will be supplemented by dynamic discovery from user's watched films
const QUIZ_ACTORS = [
    { id: 500, name: 'Tom Cruise', knownFor: 'Mission: Impossible, Top Gun' },
    { id: 6193, name: 'Leonardo DiCaprio', knownFor: 'Inception, The Revenant' },
    { id: 1892, name: 'Matt Damon', knownFor: 'The Bourne Identity, Good Will Hunting' },
    { id: 3223, name: 'Robert Downey Jr.', knownFor: 'Iron Man, Sherlock Holmes' },
    { id: 17419, name: 'Bryan Cranston', knownFor: 'Breaking Bad, Trumbo' },
    { id: 2888, name: 'Will Smith', knownFor: 'Men in Black, I Am Legend' },
    { id: 31, name: 'Tom Hanks', knownFor: 'Forrest Gump, Cast Away' },
    { id: 85, name: 'Johnny Depp', knownFor: 'Pirates of the Caribbean, Edward Scissorhands' },
    { id: 287, name: 'Brad Pitt', knownFor: 'Fight Club, Once Upon a Time in Hollywood' },
    { id: 6384, name: 'Keanu Reeves', knownFor: 'The Matrix, John Wick' },
    { id: 17052, name: 'Christian Bale', knownFor: 'The Dark Knight, American Psycho' },
    { id: 2963, name: 'Nicolas Cage', knownFor: 'Face/Off, National Treasure' },
    { id: 2524, name: 'Tom Hardy', knownFor: 'Mad Max: Fury Road, Inception' },
    { id: 976, name: 'Jason Statham', knownFor: 'The Transporter, The Expendables' },
    { id: 1136406, name: 'Tom Holland', knownFor: 'Spider-Man, Uncharted' },
    { id: 1245, name: 'Scarlett Johansson', knownFor: 'Black Widow, Lost in Translation' },
    { id: 90633, name: 'Gal Gadot', knownFor: 'Wonder Woman, Fast & Furious' },
    { id: 1373737, name: 'Florence Pugh', knownFor: 'Midsommar, Little Women' },
    { id: 224513, name: 'Ana de Armas', knownFor: 'Knives Out, Blade Runner 2049' },
    { id: 6885, name: 'Charlize Theron', knownFor: 'Mad Max: Fury Road, Atomic Blonde' },
    { id: 8784, name: 'Daniel Craig', knownFor: 'James Bond series, Knives Out' },
    { id: 17288, name: 'Michael B. Jordan', knownFor: 'Creed, Black Panther' },
    { id: 73457, name: 'Chris Hemsworth', knownFor: 'Thor, Extraction' },
    { id: 16828, name: 'Chris Evans', knownFor: 'Captain America, Knives Out' },
    { id: 1231, name: 'Julianne Moore', knownFor: 'Still Alice, The Hours' },
    { id: 10990, name: 'Emma Stone', knownFor: 'La La Land, Easy A' },
    { id: 72129, name: 'Jennifer Lawrence', knownFor: 'The Hunger Games, Silver Linings Playbook' },
    { id: 112, name: 'Cate Blanchett', knownFor: 'Carol, Blue Jasmine' },
    { id: 1813, name: 'Anne Hathaway', knownFor: 'The Dark Knight Rises, Les Misérables' },
    { id: 6161, name: 'Jennifer Aniston', knownFor: 'Friends, Horrible Bosses' },
    { id: 17647, name: 'Michelle Yeoh', knownFor: 'Everything Everywhere All at Once, Crouching Tiger' },
    { id: 5292, name: 'Denzel Washington', knownFor: 'Training Day, The Equalizer' },
    { id: 3896, name: 'Liam Neeson', knownFor: 'Taken, Schindler\'s List' },
    { id: 192, name: 'Morgan Freeman', knownFor: 'The Shawshank Redemption, Se7en' },
    { id: 2176, name: 'Samuel L. Jackson', knownFor: 'Pulp Fiction, The Avengers' },
    { id: 135651, name: 'Michael B. Jordan', knownFor: 'Creed, Black Panther' },
];

// ==== POPULAR DIRECTORS FOR QUESTIONS ====
const QUIZ_DIRECTORS = [
    { id: 525, name: 'Christopher Nolan', knownFor: 'Inception, The Dark Knight, Interstellar' },
    { id: 138, name: 'Quentin Tarantino', knownFor: 'Pulp Fiction, Kill Bill, Django Unchained' },
    { id: 578, name: 'Ridley Scott', knownFor: 'Blade Runner, Gladiator, Alien' },
    { id: 488, name: 'Steven Spielberg', knownFor: 'Jurassic Park, Schindler\'s List, E.T.' },
    { id: 1032, name: 'Martin Scorsese', knownFor: 'Goodfellas, The Departed, Taxi Driver' },
    { id: 5655, name: 'David Fincher', knownFor: 'Fight Club, Se7en, Gone Girl' },
    { id: 7467, name: 'Denis Villeneuve', knownFor: 'Dune, Blade Runner 2049, Arrival' },
    { id: 5281, name: 'Wes Anderson', knownFor: 'The Grand Budapest Hotel, Moonrise Kingdom' },
    { id: 4578, name: 'Guillermo del Toro', knownFor: 'Pan\'s Labyrinth, The Shape of Water' },
    { id: 16847, name: 'Jordan Peele', knownFor: 'Get Out, Us, Nope' },
    { id: 7624, name: 'Rian Johnson', knownFor: 'Knives Out, Looper, The Last Jedi' },
    { id: 24, name: 'James Cameron', knownFor: 'Avatar, Titanic, Terminator 2' },
    { id: 510, name: 'Tim Burton', knownFor: 'Edward Scissorhands, Beetlejuice, Batman' },
    { id: 217, name: 'David Lynch', knownFor: 'Mulholland Drive, Twin Peaks, Blue Velvet' },
    { id: 95, name: 'Stanley Kubrick', knownFor: '2001, The Shining, A Clockwork Orange' },
    { id: 6043, name: 'Edgar Wright', knownFor: 'Baby Driver, Shaun of the Dead, Hot Fuzz' },
    { id: 17625, name: 'Bong Joon-ho', knownFor: 'Parasite, Snowpiercer, The Host' },
    { id: 10099, name: 'Park Chan-wook', knownFor: 'Oldboy, The Handmaiden, Decision to Leave' },
    { id: 139, name: 'Coen Brothers', knownFor: 'Fargo, No Country for Old Men, The Big Lebowski' },
    { id: 1776, name: 'Francis Ford Coppola', knownFor: 'The Godfather, Apocalypse Now' },
    { id: 1884, name: 'Darren Aronofsky', knownFor: 'Black Swan, Requiem for a Dream, The Whale' },
    { id: 5174, name: 'Ari Aster', knownFor: 'Hereditary, Midsommar, Beau Is Afraid' },
    { id: 608, name: 'Guy Ritchie', knownFor: 'Snatch, Lock Stock, The Gentlemen' },
    { id: 59325, name: 'Greta Gerwig', knownFor: 'Barbie, Lady Bird, Little Women' },
    { id: 138781, name: 'Robert Eggers', knownFor: 'The Witch, The Lighthouse, The Northman' },
];



/**
 * Get questions already answered by user to avoid repeats
 */
async function getAnsweredQuestions(userId: string): Promise<Set<string>> {
    if (!supabase) return new Set();

    const { data, error } = await supabase
        .from('user_quiz_responses')
        .select('question_type, question_data')
        .eq('user_id', userId);

    if (error) {
        console.error('[QuizLearning] Failed to fetch answered questions', error);
        return new Set();
    }

    const answered = new Set<string>();
    for (const row of data || []) {
        const type = row.question_type;
        const qData = row.question_data as Record<string, unknown>;

        if (type === 'genre_rating' && qData.genreId) {
            answered.add(`genre:${qData.genreId}`);
        } else if (type === 'theme_preference' && qData.keywordId) {
            answered.add(`keyword:${qData.keywordId}`);
        } else if (type === 'movie_rating' && qData.tmdbId) {
            answered.add(`movie:${qData.tmdbId}`);
        } else if (type === 'subgenre_preference' && qData.subgenreKey) {
            answered.add(`subgenre:${qData.subgenreKey}`);
        } else if (type === 'actor_preference' && qData.actorId) {
            answered.add(`actor:${qData.actorId}`);
        } else if (type === 'director_preference' && qData.directorId) {
            answered.add(`director:${qData.directorId}`);
        } else if (type === 'era_preference' && qData.decade) {
            answered.add(`era:${qData.decade}`);
        }
    }

    return answered;
}

/**
 * Get candidate movies for movie rating questions from user's TMDB cache
 * FILTERS:
 * - Not watched
 * - Not already answered
 * - Not blocked (thumbs down)
 * - Genres are not "avoided" (strong negative feedback)
 * 
 * VARIETY:
 * - Shuffles trending list to avoid "only recent movies" bias
 */
async function getCandidateMovies(userId: string, answered: Set<string>): Promise<MovieRatingQuestion[]> {
    if (!supabase) return [];

    try {
        // 1. Get watched movies (paginated - PostgREST defaults to 1000 max per request)
        const pageSize = 1000;
        let from = 0;
        const allWatchedIds: number[] = [];

        while (true) {
            const { data: pageData, error: pageError } = await supabase
                .from('film_tmdb_map')
                .select('tmdb_id')
                .eq('user_id', userId)
                .range(from, from + pageSize - 1);

            if (pageError) {
                console.warn('[QuizLearning] Error fetching watched movies page', { from, error: pageError });
                break;
            }

            const rows = pageData ?? [];
            allWatchedIds.push(...rows.map(r => r.tmdb_id));

            // If we got fewer than pageSize, we've fetched all rows
            if (rows.length < pageSize) break;
            from += pageSize;
        }

        const watchedIds = new Set(allWatchedIds);

        // 2. Get blocked suggestions (thumbs down)
        const { data: blockedData } = await supabase
            .from('blocked_suggestions')
            .select('tmdb_id')
            .eq('user_id', userId);
        const blockedIds = new Set((blockedData || []).map(r => r.tmdb_id));

        // 3. Get avoided genres (negative feedback)
        // Consider avoided if negative > positive + 2, or preference < 0.3
        const { data: genreFeedback } = await supabase
            .from('user_feature_feedback')
            .select('feature_id, positive_count, negative_count, inferred_preference')
            .eq('user_id', userId)
            .eq('feature_type', 'genre');

        const avoidedGenreIds = new Set<number>();
        for (const f of genreFeedback || []) {
            // BE LENIENT FOR QUIZ: Only truly avoid if preference is VERY low (e.g. < 0.2)
            // We want the quiz to occasionally test if they still hate a genre
            if (f.inferred_preference < 0.2 || f.negative_count > (f.positive_count + 5)) {
                avoidedGenreIds.add(f.feature_id);
            }
        }

        // 4. Source A: Get trending/popular movies (week + month for more variety)
        const [{ data: weeklyTrending }, { data: monthlyTrending }] = await Promise.all([
            supabase.from('tmdb_trending').select('tmdb_id').eq('period', 'week').limit(200),
            supabase.from('tmdb_trending').select('tmdb_id').eq('period', 'month').limit(200),
        ]);

        // 5. Source B: Get RANDOM library movies from multiple offsets (Classic/Deep Cuts)
        // Sample from 3 different random positions to increase variety
        const { count } = await supabase
            .from('tmdb_movies')
            .select('*', { count: 'exact', head: true });

        const totalMovies = count || 5000;
        const batchSize = 150;
        const numBatches = 3;
        const libraryPromises = [];

        for (let i = 0; i < numBatches; i++) {
            const randomOffset = Math.floor(Math.random() * Math.max(0, totalMovies - batchSize));
            libraryPromises.push(
                supabase.from('tmdb_movies').select('tmdb_id').range(randomOffset, randomOffset + batchSize - 1)
            );
        }

        const libraryResults = await Promise.all(libraryPromises);
        const libraryIds = libraryResults.flatMap(r => (r.data || []).map(row => row.tmdb_id));

        // Combine all sources (~400 trending + ~450 library = ~850 candidates)
        const allCandidates = [
            ...(weeklyTrending || []).map(r => r.tmdb_id),
            ...(monthlyTrending || []).map(r => r.tmdb_id),
            ...libraryIds
        ];

        // 6. Filter IDs by watched/blocked/answered
        const seenCandidates = new Set<number>();
        let candidateIds = allCandidates.filter(id => {
            if (seenCandidates.has(id)) return false;
            seenCandidates.add(id);
            return true;
        })
            .filter(id =>
                !watchedIds.has(id) &&
                !blockedIds.has(id) &&
                !answered.has(`movie:${id}`)
            );

        if (candidateIds.length === 0) return [];

        // 6. SHUFFLE to reduce recency/popularity bias
        // This ensures typically "lower ranked" trending movies get a chance
        candidateIds = candidateIds.sort(() => Math.random() - 0.5);

        // 7. Fetch details for a chunk (e.g. top 100 after shuffle)
        // We fetch more than we need because some might be filtered by genre
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', candidateIds.slice(0, 100)); // Take 100 random candidates

        const questions: MovieRatingQuestion[] = [];

        for (const row of movieData || []) {
            const movie = row.data as Record<string, unknown>;
            const genres = (movie.genres as Array<{ id: number; name: string }>) || [];

            // 8. Filter by AVOIDED GENRES
            // If movie ONLY has avoided genres, skip it. If it has at least one neutral/good one, keep it.
            const allGenresAvoided = genres.length > 0 && genres.every(g => avoidedGenreIds.has(g.id));
            if (allGenresAvoided) continue;

            // Extract trailer
            const videos = (movie.videos as { results?: Array<{ site: string; type: string; key: string; official?: boolean }> })?.results || [];
            const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official)
                || videos.find(v => v.site === 'YouTube' && v.type === 'Trailer');

            questions.push({
                type: 'movie_rating' as const,
                tmdbId: row.tmdb_id,
                title: (movie.title as string) || 'Unknown',
                year: movie.release_date ? String(movie.release_date).slice(0, 4) : undefined,
                posterPath: movie.poster_path as string | null,
                overview: movie.overview as string || undefined,
                genres: genres.map(g => g.name),
                trailerKey: trailer?.key || null,
                consensusLevel: 'low', // Default for quiz/trending candidates
            });
        }

        return questions;
    } catch (e) {
        console.error('[QuizLearning] Failed to get candidate movies', e);
        return [];
    }
}

/**
 * Get existing feature feedback to identify gaps and ambiguities
 */
async function getFeatureFeedback(userId: string): Promise<Map<string, { positive: number; negative: number; total: number; preference: number }>> {
    if (!supabase) return new Map();

    const { data, error } = await supabase
        .from('user_feature_feedback')
        .select('feature_type, feature_id, positive_count, negative_count, inferred_preference')
        .eq('user_id', userId);

    if (error) {
        console.error('[QuizLearning] Failed to fetch feature feedback', error);
        return new Map();
    }

    const feedback = new Map<string, { positive: number; negative: number; total: number; preference: number }>();
    for (const row of data || []) {
        const key = `${row.feature_type}:${row.feature_id}`;
        feedback.set(key, {
            positive: row.positive_count,
            negative: row.negative_count,
            total: row.positive_count + row.negative_count,
            preference: row.inferred_preference,
        });
    }
    return feedback;
}

/**
 * Score a feature for quiz priority
 * Lower score = higher priority (ask first)
 * Priority order: 1) No data 2) Low data 3) Ambiguous 4) Strong preference
 */
function scoreFeaturePriority(feedback: Map<string, { positive: number; negative: number; total: number; preference: number }>, type: string, id: number): number {
    const key = `${type}:${id}`;
    const data = feedback.get(key);

    if (!data) {
        // No data - highest priority (score 0)
        return 0;
    }

    if (data.total < 3) {
        // Low data - high priority (score 1-10 based on count)
        return data.total * 3;
    }

    // Ambiguous preferences (near 0.5) are higher priority than strong ones
    const ambiguity = 1 - Math.abs(data.preference - 0.5) * 2; // 0 = strong, 1 = ambiguous
    return 10 + (1 - ambiguity) * 40; // Score 10-50 based on clarity
}

/**
 * Generate a batch of quiz questions for a session
 * NOW WITH MASSIVE QUESTION POOL:
 * - 18 Genres
 * - 150+ Keywords/Themes
 * - 75+ Subgenres
 * - 35+ Actors
 * - 25+ Directors
 * - 11 Eras
 * - Unlimited Movie questions
 * 
 * SMART PRIORITIZATION:
 * 1. First, ask about features with NO existing data (cold start)
 * 2. Then, ask about features with LOW sample counts (<3)
 * 3. Then, ask about AMBIGUOUS preferences (near 0.5)
 * 4. Random fallback for well-understood preferences
 */
export async function generateQuizQuestions(
    userId: string,
    count: number = 10
): Promise<QuizQuestion[]> {
    const answered = await getAnsweredQuestions(userId);
    const feedback = await getFeatureFeedback(userId);
    const questions: QuizQuestion[] = [];

    // === Build all question pools with priority scores ===

    // Genres (18)
    const unansweredGenres = QUIZ_GENRES
        .filter(g => !answered.has(`genre:${g.id}`))
        .map(g => ({ ...g, priority: scoreFeaturePriority(feedback, 'genre', g.id) }))
        .sort((a, b) => a.priority - b.priority);

    // Keywords/Themes (150+)
    const unansweredKeywords = QUIZ_KEYWORDS
        .filter(k => !answered.has(`keyword:${k.id}`))
        .map(k => ({ ...k, priority: scoreFeaturePriority(feedback, 'keyword', k.id) }))
        .sort((a, b) => a.priority - b.priority);

    // Subgenres (75+) - using stringHash for ID
    const unansweredSubgenres = QUIZ_SUBGENRES
        .filter(s => !answered.has(`subgenre:${s.key}`))
        .map(s => ({ ...s, priority: scoreFeaturePriority(feedback, 'subgenre', stringHash(s.key)) }))
        .sort((a, b) => a.priority - b.priority);

    // Actors (35+)
    const unansweredActors = QUIZ_ACTORS
        .filter(a => !answered.has(`actor:${a.id}`))
        .map(a => ({ ...a, priority: scoreFeaturePriority(feedback, 'actor', a.id) }))
        .sort((a, b) => a.priority - b.priority);

    // Directors (25+)
    const unansweredDirectors = QUIZ_DIRECTORS
        .filter(d => !answered.has(`director:${d.id}`))
        .map(d => ({ ...d, priority: scoreFeaturePriority(feedback, 'director', d.id) }))
        .sort((a, b) => a.priority - b.priority);

    // Eras (11)
    const unansweredEras = QUIZ_ERAS
        .filter(e => !answered.has(`era:${e.decade}`))
        .map(e => ({ ...e, priority: scoreFeaturePriority(feedback, 'decade', e.decade) }))
        .sort((a, b) => a.priority - b.priority);

    // Movies (unlimited from DB)
    const candidateMovies = await getCandidateMovies(userId, answered);
    const shuffledMovies = [...candidateMovies].sort(() => Math.random() - 0.5);

    // Try to find a good pairwise match (movies sharing genres)
    let pairwiseQuestion: PairwiseQuestion | null = null;
    if (shuffledMovies.length >= 2) {
        const m1 = shuffledMovies[0];
        // Look for a match in the next 10 candidates
        for (let i = 1; i < Math.min(shuffledMovies.length, 12); i++) {
            const m2 = shuffledMovies[i];
            const sharedGenre = m1.genres?.some(g => m2.genres?.includes(g));
            if (sharedGenre) {
                // Found a match!
                pairwiseQuestion = { type: 'pairwise', movieA: m1, movieB: m2 };
                // Remove both from pool
                shuffledMovies.splice(i, 1);
                shuffledMovies.splice(0, 1);
                break;
            }
        }
    }

    // Calculate pool sizes
    const totalStaticPool = unansweredGenres.length + unansweredKeywords.length +
        unansweredSubgenres.length + unansweredActors.length +
        unansweredDirectors.length + unansweredEras.length;

    console.log('[QuizLearning] Question pool sizes', {
        genres: unansweredGenres.length,
        keywords: unansweredKeywords.length,
        subgenres: unansweredSubgenres.length,
        actors: unansweredActors.length,
        directors: unansweredDirectors.length,
        eras: unansweredEras.length,
        movies: shuffledMovies.length,
        totalStatic: totalStaticPool,
    });

    // === Build question list with balanced distribution ===
    // New rotation includes ALL question types for variety
    // Pattern: Genre, Subgenre, Keyword, Movie, Actor, Director, Era, Keyword, Movie, Subgenre
    const typeRotation: QuizQuestionType[] = [
        'genre_rating',
        'subgenre_preference',
        'theme_preference',
        'movie_rating',
        'actor_preference',
        'theme_preference',
        'director_preference',
        'subgenre_preference',
        'era_preference',
        'movie_rating',
        'movie_rating',
        'pairwise', // Inject pairwise here
    ];

    // Indices for each pool
    let genreIdx = 0, keywordIdx = 0, movieIdx = 0;
    let subgenreIdx = 0, actorIdx = 0, directorIdx = 0, eraIdx = 0;
    let pairwiseUsed = false;

    // Helper to find next available question (balanced fallback)
    const getNextAvailable = (): QuizQuestion | null => {
        // Find pool with highest priority item (lowest priority score)
        const pools = [
            { type: 'movie_rating', count: shuffledMovies.length - movieIdx },
            { type: 'theme_preference', count: unansweredKeywords.length - keywordIdx, score: unansweredKeywords[keywordIdx]?.priority ?? 999 },
            { type: 'subgenre_preference', count: unansweredSubgenres.length - subgenreIdx, score: unansweredSubgenres[subgenreIdx]?.priority ?? 999 },
            { type: 'actor_preference', count: unansweredActors.length - actorIdx, score: unansweredActors[actorIdx]?.priority ?? 999 },
            { type: 'director_preference', count: unansweredDirectors.length - directorIdx, score: unansweredDirectors[directorIdx]?.priority ?? 999 },
            { type: 'genre_rating', count: unansweredGenres.length - genreIdx, score: unansweredGenres[genreIdx]?.priority ?? 999 },
            { type: 'era_preference', count: unansweredEras.length - eraIdx, score: unansweredEras[eraIdx]?.priority ?? 999 },
        ];

        // Filter out empty pools
        const availablePools = pools.filter(p => p.count > 0);
        if (availablePools.length === 0) return null;

        // Sort by priority score (lowest first)
        const sorted = availablePools.sort((a, b) => {
            const scoreA = a.type === 'movie_rating' ? 5 : (a.score ?? 999);
            const scoreB = b.type === 'movie_rating' ? 5 : (b.score ?? 999);
            return scoreA - scoreB;
        });

        const bestPool = sorted[0];

        if (bestPool.type === 'movie_rating') return shuffledMovies[movieIdx++];
        if (bestPool.type === 'theme_preference') {
            const kw = unansweredKeywords[keywordIdx++];
            return { type: 'theme_preference', keywordId: kw.id, keywordName: kw.name };
        }
        if (bestPool.type === 'subgenre_preference') {
            const sg = unansweredSubgenres[subgenreIdx++];
            return { type: 'subgenre_preference', subgenreKey: sg.key, subgenreName: sg.name, parentGenreName: sg.parent };
        }
        if (bestPool.type === 'actor_preference') {
            const actor = unansweredActors[actorIdx++];
            return { type: 'actor_preference', actorId: actor.id, actorName: actor.name, knownFor: actor.knownFor };
        }
        if (bestPool.type === 'director_preference') {
            const dir = unansweredDirectors[directorIdx++];
            return { type: 'director_preference', directorId: dir.id, directorName: dir.name, knownFor: dir.knownFor };
        }
        if (bestPool.type === 'genre_rating') {
            const genre = unansweredGenres[genreIdx++];
            return { type: 'genre_rating', genreId: genre.id, genreName: genre.name };
        }
        if (bestPool.type === 'era_preference') {
            const era = unansweredEras[eraIdx++];
            return { type: 'era_preference', decade: era.decade, eraName: era.name, eraDescription: era.description };
        }

        return null;
    };

    for (let i = 0; i < count; i++) {
        const targetType = typeRotation[i % typeRotation.length];
        let question: QuizQuestion | null = null;

        // Try to get the target type first
        if (targetType === 'genre_rating' && genreIdx < unansweredGenres.length) {
            const genre = unansweredGenres[genreIdx++];
            question = { type: 'genre_rating', genreId: genre.id, genreName: genre.name };
        } else if (targetType === 'theme_preference' && keywordIdx < unansweredKeywords.length) {
            const kw = unansweredKeywords[keywordIdx++];
            question = { type: 'theme_preference', keywordId: kw.id, keywordName: kw.name };
        } else if (targetType === 'movie_rating' && movieIdx < shuffledMovies.length) {
            question = shuffledMovies[movieIdx++];
        } else if (targetType === 'subgenre_preference' && subgenreIdx < unansweredSubgenres.length) {
            const sg = unansweredSubgenres[subgenreIdx++];
            question = { type: 'subgenre_preference', subgenreKey: sg.key, subgenreName: sg.name, parentGenreName: sg.parent };
        } else if (targetType === 'actor_preference' && actorIdx < unansweredActors.length) {
            const actor = unansweredActors[actorIdx++];
            question = { type: 'actor_preference', actorId: actor.id, actorName: actor.name, knownFor: actor.knownFor };
        } else if (targetType === 'director_preference' && directorIdx < unansweredDirectors.length) {
            const dir = unansweredDirectors[directorIdx++];
            question = { type: 'director_preference', directorId: dir.id, directorName: dir.name, knownFor: dir.knownFor };
        } else if (targetType === 'era_preference' && eraIdx < unansweredEras.length) {
            const era = unansweredEras[eraIdx++];
            question = { type: 'era_preference', decade: era.decade, eraName: era.name, eraDescription: era.description };
        } else if (targetType === 'pairwise' && pairwiseQuestion && !pairwiseUsed) {
            question = pairwiseQuestion;
            pairwiseUsed = true;
        }

        // Fallback if target type exhausted
        if (!question) {
            question = getNextAvailable();
        }

        if (question) {
            questions.push(question);
        } else {
            // Truly exhausted all pools
            break;
        }
    }

    const hasData = feedback.size > 0;
    console.log('[QuizLearning] Generated questions', {
        requested: count,
        generated: questions.length,
        types: questions.reduce((acc, q) => {
            acc[q.type] = (acc[q.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>),
        strategy: hasData ? 'smart-prioritized' : 'cold-start',
    });

    return questions;
}

/**
 * Record a quiz answer and update feature preferences
 */
export async function recordQuizAnswer(
    userId: string,
    question: QuizQuestion,
    answer: QuizAnswer
): Promise<void> {
    if (!supabase) return;

    // Store the quiz response
    const { error: insertError } = await supabase
        .from('user_quiz_responses')
        .insert({
            user_id: userId,
            question_type: question.type,
            question_data: question,
            answer: answer,
        });

    if (insertError) {
        console.error('[QuizLearning] Failed to insert quiz response', insertError);
        return;
    }

    // Update feature preferences based on answer type
    if (question.type === 'genre_rating') {
        await updateGenrePreference(userId, question, answer as GenreRatingAnswer);
    } else if (question.type === 'theme_preference') {
        await updateKeywordPreference(userId, question, answer as ThemePreferenceAnswer);
    } else if (question.type === 'movie_rating') {
        await updateMoviePreference(userId, question, answer as MovieRatingAnswer);
    } else if (question.type === 'subgenre_preference') {
        await updateSubgenrePreference(userId, question, answer as SubgenrePreferenceAnswer);
    } else if (question.type === 'actor_preference') {
        await updateActorPreference(userId, question, answer as PersonPreferenceAnswer);
    } else if (question.type === 'director_preference') {
        await updateDirectorPreference(userId, question, answer as PersonPreferenceAnswer);
    } else if (question.type === 'era_preference') {
        await updateEraPreference(userId, question, answer as EraPreferenceAnswer);
    } else if (question.type === 'pairwise') {
        const pAnswer = answer as PairwiseAnswer;
        // Treat winner as positive rating, loser as negative (mild)
        // We reuse the updateMoviePreference logic but mocking the question/answer
        // Winner
        const pQuestion = question as PairwiseQuestion;
        const winner = pQuestion.movieA.tmdbId === pAnswer.winnerId ? pQuestion.movieA : pQuestion.movieB;
        const loser = pQuestion.movieA.tmdbId === pAnswer.loserId ? pQuestion.movieA : pQuestion.movieB;

        await updateMoviePreference(userId, winner, { thumbsUp: true });
        // Award mild negative feedback for the loser
        await updateMoviePreference(userId, loser, { thumbsUp: false });

        // Also add to pairwise_events table directly if possible
        if (supabase) {
            const { error: pwError } = await supabase.from('pairwise_events').insert({
                user_id: userId,
                winner_tmdb_id: pAnswer.winnerId,
                loser_tmdb_id: pAnswer.loserId,
                // Note: session_id might be missing in schema, check if we need to add it or skip
                winner_consensus: winner.consensusLevel || 'low',
                loser_consensus: loser.consensusLevel || 'low',
                shared_reason_tags: ['quiz_match']
            });
            if (pwError) console.error('[QuizLearning] Failed to insert pairwise event', pwError);
        }
    }

    console.log('[QuizLearning] Recorded answer', {
        userId: userId.slice(0, 8),
        type: question.type,
        answer
    });
}

/**
 * Update subgenre preference based on quiz answer
 */
async function updateSubgenrePreference(
    userId: string,
    question: SubgenrePreferenceQuestion,
    answer: SubgenrePreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    // Map preference to positive/negative counts
    // love: +3 pos, +0 neg | like: +2 pos, +0 neg | neutral: +1 pos, +1 neg | dislike: +0 pos, +3 neg
    const prefMap: Record<string, { pos: number; neg: number }> = {
        love: { pos: 3, neg: 0 },
        like: { pos: 2, neg: 0 },
        neutral: { pos: 1, neg: 1 },
        dislike: { pos: 0, neg: 3 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };
    const subgenreId = stringHash(question.subgenreKey);

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'subgenre')
        .eq('feature_id', subgenreId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'subgenre',
            feature_id: subgenreId,
            feature_name: question.subgenreKey,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update actor preference based on quiz answer
 */
async function updateActorPreference(
    userId: string,
    question: ActorPreferenceQuestion,
    answer: PersonPreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    // Map preference to positive/negative counts
    // fan: +3 pos, +0 neg | neutral: +1 pos, +1 neg | avoid: +0 pos, +3 neg
    const prefMap: Record<string, { pos: number; neg: number }> = {
        fan: { pos: 3, neg: 0 },
        neutral: { pos: 1, neg: 1 },
        avoid: { pos: 0, neg: 3 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'actor')
        .eq('feature_id', question.actorId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'actor',
            feature_id: question.actorId,
            feature_name: question.actorName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update director preference based on quiz answer
 */
async function updateDirectorPreference(
    userId: string,
    question: DirectorPreferenceQuestion,
    answer: PersonPreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    const prefMap: Record<string, { pos: number; neg: number }> = {
        fan: { pos: 3, neg: 0 },
        neutral: { pos: 1, neg: 1 },
        avoid: { pos: 0, neg: 3 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'director')
        .eq('feature_id', question.directorId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'director',
            feature_id: question.directorId,
            feature_name: question.directorName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update era/decade preference based on quiz answer
 */
async function updateEraPreference(
    userId: string,
    question: EraPreferenceQuestion,
    answer: EraPreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    const prefMap: Record<string, { pos: number; neg: number }> = {
        love: { pos: 3, neg: 0 },
        like: { pos: 2, neg: 0 },
        neutral: { pos: 1, neg: 1 },
        dislike: { pos: 0, neg: 3 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'decade')
        .eq('feature_id', question.decade)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'decade',
            feature_id: question.decade,
            feature_name: question.eraName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update genre preference based on quiz rating
 */
async function updateGenrePreference(
    userId: string,
    question: GenreRatingQuestion,
    answer: GenreRatingAnswer
): Promise<void> {
    if (!supabase) return;

    // Map rating to positive/negative counts
    // 1=Never: +0 pos, +3 neg | 2=Rarely: +0 pos, +2 neg | 3=Sometimes: +1 pos, +1 neg
    // 4=Often: +2 pos, +0 neg | 5=Love: +3 pos, +0 neg
    const ratingMap: Record<number, { pos: number; neg: number }> = {
        1: { pos: 0, neg: 3 },
        2: { pos: 0, neg: 2 },
        3: { pos: 1, neg: 1 },
        4: { pos: 2, neg: 0 },
        5: { pos: 3, neg: 0 },
    };

    const delta = ratingMap[answer.rating] || { pos: 1, neg: 1 };

    // Fetch existing preference
    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'genre')
        .eq('feature_id', question.genreId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2); // Laplace smoothing

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'genre',
            feature_id: question.genreId,
            feature_name: question.genreName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update keyword preference based on quiz answer
 */
async function updateKeywordPreference(
    userId: string,
    question: ThemePreferenceQuestion,
    answer: ThemePreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    // Map preference to positive/negative counts
    // yes: +2 pos, +0 neg | maybe: +1 pos, +1 neg | no: +0 pos, +2 neg
    const prefMap: Record<string, { pos: number; neg: number }> = {
        yes: { pos: 2, neg: 0 },
        maybe: { pos: 1, neg: 1 },
        no: { pos: 0, neg: 2 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'keyword')
        .eq('feature_id', question.keywordId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'keyword',
            feature_id: question.keywordId,
            feature_name: question.keywordName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Helper to update a single feature preference
 */
async function updateSingleFeaturePreference(
    userId: string,
    type: string,
    id: number,
    name: string,
    isPositive: boolean
) {
    if (!supabase) return;

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', type)
        .eq('feature_id', id)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + (isPositive ? 1 : 0);
    const negativeCount = (existing?.negative_count || 0) + (isPositive ? 0 : 1);
    const total = positiveCount + negativeCount;
    // Bayesian avg with Laplace smoothing
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: type,
            feature_id: id,
            feature_name: name,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}
async function updateMoviePreference(
    userId: string,
    question: MovieRatingQuestion,
    answer: MovieRatingAnswer
): Promise<void> {
    if (!supabase) return;

    // Fetch movie details to get features
    const { data: movieData } = await supabase
        .from('tmdb_movies')
        .select('data')
        .eq('tmdb_id', question.tmdbId)
        .maybeSingle();

    if (!movieData?.data) return;

    const movie = movieData.data as Record<string, unknown>;
    const isPositive = answer.thumbsUp;

    // Update genre preferences
    const genres = (movie.genres as Array<{ id: number; name: string }>) || [];
    for (const genre of genres.slice(0, 3)) {
        await updateSingleFeaturePreference(userId, 'genre', genre.id, genre.name, isPositive);
    }

    // Update keyword preferences
    const keywords = (movie.keywords as { keywords?: Array<{ id: number; name: string }> })?.keywords || [];
    const keywordNames = keywords.map(k => k.name);
    const keywordIds = keywords.map(k => k.id);
    for (const kw of keywords.slice(0, 5)) {
        await updateSingleFeaturePreference(userId, 'keyword', kw.id, kw.name, isPositive);
    }

    // Update subgenre preferences
    const title = (movie.title as string) || '';
    const overview = (movie.overview as string) || '';
    const allText = `${title} ${overview}`.toLowerCase();

    for (const genre of genres) {
        const subs = detectSubgenres(genre.name, allText, keywordNames, keywordIds);
        for (const subKey of subs) {
            const id = stringHash(subKey);
            await updateSingleFeaturePreference(userId, 'subgenre', id, subKey, isPositive);
        }
    }

    // Update actor preferences
    const credits = movie.credits as { cast?: Array<{ id: number; name: string; order: number }>; crew?: Array<{ id: number; name: string; job: string }> } | undefined;
    const cast = (credits?.cast || []).slice(0, 3);
    for (const actor of cast) {
        await updateSingleFeaturePreference(userId, 'actor', actor.id, actor.name, isPositive);
    }

    // Update director preferences
    const directors = (credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2);
    for (const director of directors) {
        await updateSingleFeaturePreference(userId, 'director', director.id, director.name, isPositive);
    }

    // Add to blocked suggestions if thumbs down
    if (!isPositive) {
        await supabase
            .from('blocked_suggestions')
            .upsert({
                user_id: userId,
                tmdb_id: question.tmdbId,
                blocked_at: new Date().toISOString(),
            }, { onConflict: 'user_id,tmdb_id' });
    }
}

/**
 * Get quiz stats for a user
 */
export async function getQuizStats(userId: string): Promise<{
    totalAnswered: number;
    byType: Record<QuizQuestionType, number>;
    lastQuizDate: string | null;
}> {
    const emptyStats: Record<QuizQuestionType, number> = {
        genre_rating: 0,
        theme_preference: 0,
        movie_rating: 0,
        subgenre_preference: 0,
        actor_preference: 0,
        director_preference: 0,
        era_preference: 0,
        pairwise: 0,
    };

    if (!supabase) {
        return { totalAnswered: 0, byType: emptyStats, lastQuizDate: null };
    }

    const { data, error } = await supabase
        .from('user_quiz_responses')
        .select('question_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[QuizLearning] Failed to get quiz stats', error);
        return { totalAnswered: 0, byType: emptyStats, lastQuizDate: null };
    }

    const byType: Record<QuizQuestionType, number> = { ...emptyStats };

    for (const row of data || []) {
        const type = row.question_type as QuizQuestionType;
        if (byType[type] !== undefined) {
            byType[type]++;
        }
    }

    return {
        totalAnswered: data?.length || 0,
        byType,
        lastQuizDate: data?.[0]?.created_at || null,
    };
}


/**
 * Seed user preferences from import history
 * This should run ONCE after import to pre-populate user_feature_feedback
 * based on the user's watch history (ratings, likes, rewatches)
 * 
 * Weight calculation:
 * - Highly rated (4.5-5 stars) or liked + rewatch: +3 positive
 * - Good rating (3.5-4 stars) or liked: +2 positive
 * - Average (3 stars): +1 positive
 * - Low rating (1-2 stars): +2 negative
 * - Very low rating (0.5-1 stars): +3 negative
 */
export async function seedPreferencesFromHistory(
    userId: string,
    films: Array<{
        tmdbId: number;
        rating?: number;
        liked?: boolean;
        rewatch?: boolean;
    }>,
    onProgress?: (current: number, total: number) => void
): Promise<{
    success: boolean;
    genresSeeded: number;
    keywordsSeeded: number;
    actorsSeeded: number;
    directorsSeeded: number;
    subgenresSeeded: number;
    erasSeeded: number;
}> {
    if (!supabase) {
        return { success: false, genresSeeded: 0, keywordsSeeded: 0, actorsSeeded: 0, directorsSeeded: 0, subgenresSeeded: 0, erasSeeded: 0 };
    }

    console.log('[SeedPreferences] Starting preference seeding', { userId: userId.slice(0, 8), filmCount: films.length });

    // Aggregate feature weights
    const genreWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const keywordWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const actorWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const directorWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const subgenreWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const eraWeights = new Map<number, { name: string; positive: number; negative: number }>(); // NEW: Decade preferences

    // Helper to generate a stable numeric ID from a string key (for subgenres)
    // We define it here to avoid polluting module scope if only used here
    // const stringHash = (str: string): number => { ... } // REMOVED local definition

    // Get weight delta based on rating/like/rewatch
    const getWeightDelta = (film: typeof films[0]): { pos: number; neg: number } => {
        const rating = film.rating ?? 0;
        const hasRating = rating > 0;

        // Liked + rewatch = strong positive
        if (film.liked && film.rewatch) return { pos: 3, neg: 0 };

        // Very high rating (4.5-5)
        if (hasRating && rating >= 4.5) return { pos: 3, neg: 0 };

        // Good rating (3.5-4.5) or liked
        if ((hasRating && rating >= 3.5) || film.liked) return { pos: 2, neg: 0 };

        // Average (3)
        if (hasRating && rating >= 3) return { pos: 1, neg: 0 };

        // Low rating (1.5-2.5)
        if (hasRating && rating >= 1.5) return { pos: 0, neg: 2 };

        // Very low rating (0.5-1)
        if (hasRating && rating >= 0.5) return { pos: 0, neg: 3 };

        // No rating, no like - neutral, skip
        return { pos: 0, neg: 0 };
    };

    // Process each film
    let processed = 0;
    for (const film of films) {
        const delta = getWeightDelta(film);
        if (delta.pos === 0 && delta.neg === 0) {
            processed++;
            continue; // Skip films with no signal
        }

        // Fetch movie features from cache
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('data')
            .eq('tmdb_id', film.tmdbId)
            .maybeSingle();

        if (!movieData?.data) {
            processed++;
            continue;
        }

        const movie = movieData.data as Record<string, unknown>;

        // Extract genres
        const genres = (movie.genres as Array<{ id: number; name: string }>) || [];
        for (const genre of genres.slice(0, 3)) {
            const existing = genreWeights.get(genre.id) || { name: genre.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            genreWeights.set(genre.id, existing);
        }

        // Extract keywords
        const keywords = (movie.keywords as { keywords?: Array<{ id: number; name: string }> })?.keywords || [];
        const keywordNames = keywords.map(k => k.name);
        const keywordIds = keywords.map(k => k.id);

        for (const kw of keywords.slice(0, 5)) {
            const existing = keywordWeights.get(kw.id) || { name: kw.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            keywordWeights.set(kw.id, existing);
        }

        // Extract and process SUBGENRES
        const title = (movie.title as string) || '';
        const overview = (movie.overview as string) || '';
        const allText = `${title} ${overview}`.toLowerCase();

        for (const genre of genres) {
            const subs = detectSubgenres(genre.name, allText, keywordNames, keywordIds);
            subs.forEach(subKey => {
                // Use hash for ID, but store Key as name
                const id = stringHash(subKey);
                const existing = subgenreWeights.get(id) || { name: subKey, positive: 0, negative: 0 };
                existing.positive += delta.pos;
                existing.negative += delta.neg;
                subgenreWeights.set(id, existing);
            });
        }

        // Extract cast (top 3 actors)
        const credits = movie.credits as { cast?: Array<{ id: number; name: string; order: number }>; crew?: Array<{ id: number; name: string; job: string }> } | undefined;
        const cast = (credits?.cast || []).slice(0, 3);
        for (const actor of cast) {
            const existing = actorWeights.get(actor.id) || { name: actor.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            actorWeights.set(actor.id, existing);
        }

        // Extract directors
        const directors = (credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2);
        for (const director of directors) {
            const existing = directorWeights.get(director.id) || { name: director.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            directorWeights.set(director.id, existing);
        }

        // Extract ERA/DECADE preferences (NEW)
        const releaseDate = movie.release_date as string | undefined;
        if (releaseDate && releaseDate.length >= 4) {
            const year = parseInt(releaseDate.substring(0, 4));
            if (!isNaN(year) && year >= 1920) {
                const decade = Math.floor(year / 10) * 10;
                const eraLabel = `${decade}s`;
                const eraId = decade; // Use decade (1980, 1990, etc.) as ID

                const existing = eraWeights.get(eraId) || { name: eraLabel, positive: 0, negative: 0 };
                existing.positive += delta.pos;
                existing.negative += delta.neg;
                eraWeights.set(eraId, existing);
            }
        }

        processed++;
        if (onProgress && processed % 50 === 0) {
            onProgress(processed, films.length);
        }
    }

    console.log('[SeedPreferences] Aggregated weights', {
        genres: genreWeights.size,
        keywords: keywordWeights.size,
        actors: actorWeights.size,
        directors: directorWeights.size,
        subgenres: subgenreWeights.size,
        eras: eraWeights.size,
    });

    // Upsert to user_feature_feedback
    const upsertFeatures = async (
        type: string,
        weights: Map<number, { name: string; positive: number; negative: number }>
    ): Promise<number> => {
        let count = 0;
        const updates = [];
        for (const [id, data] of weights.entries()) {
            // Only seed if there's significant signal (2+ interactions)
            if (data.positive + data.negative < 2) continue;

            const total = data.positive + data.negative;
            const inferredPreference = (data.positive + 1) / (total + 2); // Laplace smoothing

            updates.push({
                user_id: userId,
                feature_type: type,
                feature_id: id,
                feature_name: data.name,
                positive_count: data.positive,
                negative_count: data.negative,
                inferred_preference: inferredPreference,
                last_updated: new Date().toISOString(),
            });

            if (updates.length >= 50) {
                if (supabase) {
                    await supabase.from('user_feature_feedback').upsert(updates, { onConflict: 'user_id,feature_type,feature_id' });
                }
                count += updates.length;
                updates.length = 0;
            }
        }

        if (updates.length > 0 && supabase) {
            await supabase.from('user_feature_feedback').upsert(updates, { onConflict: 'user_id,feature_type,feature_id' });
            count += updates.length;
        }
        return count;
    };

    const genresSeeded = await upsertFeatures('genre', genreWeights);
    const keywordsSeeded = await upsertFeatures('keyword', keywordWeights);
    const actorsSeeded = await upsertFeatures('actor', actorWeights);
    const directorsSeeded = await upsertFeatures('director', directorWeights);
    const subgenresSeeded = await upsertFeatures('subgenre', subgenreWeights);
    const erasSeeded = await upsertFeatures('era', eraWeights);

    console.log('[SeedPreferences] Seeding complete', {
        userId: userId.slice(0, 8),
        genresSeeded,
        keywordsSeeded,
        actorsSeeded,
        directorsSeeded,
        subgenresSeeded,
        erasSeeded
    });

    return { success: true, genresSeeded, keywordsSeeded, actorsSeeded, directorsSeeded, subgenresSeeded, erasSeeded };
}
