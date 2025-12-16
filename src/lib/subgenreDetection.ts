/**
 * Advanced Subgenre Detection and Cross-Genre Pattern Analysis
 * Detects nuanced preferences like "action but not superhero" or "sci-fi space but not anime sci-fi"
 */

import { getSubgenreFromKeywordId } from './tmdbKeywordIds';

/**
 * Generate a stable numeric ID from a string key
 * Used to store subgenres in feature_id columns
 */
export function stringHash(str: string): number {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export type SubgenrePattern = {
  parentGenre: string;
  subgenres: Map<string, {
    watched: number;
    liked: number;
    avgRating: number;
    weight: number;
  }>;
  avoidedSubgenres: Set<string>;
  preferredSubgenres: Set<string>;
};

export type CrossGenrePattern = {
  combination: string; // e.g., "Action+Thriller"
  keywords: Set<string>; // e.g., ["spy", "espionage", "agent"]
  watched: number;
  liked: number;
  avgRating: number;
  weight: number;
  examples: string[]; // Example movie titles
};

/**
 * Comprehensive keyword mappings for subgenre detection
 * 90+ subgenres across all major genres for nuanced preference learning
 */
export const SUBGENRE_KEYWORDS = {
  // ============================================
  // HORROR SUBGENRES (25+)
  // ============================================
  HORROR_SUPERNATURAL: ['supernatural', 'ghost', 'demon', 'possession', 'haunted', 'paranormal', 'spirit', 'poltergeist', 'séance', 'ouija', 'exorcism'],
  HORROR_PSYCHOLOGICAL: ['psychological horror', 'mind games', 'mental breakdown', 'madness', 'insanity', 'unreliable narrator', 'hallucination', 'paranoia'],
  HORROR_SLASHER: ['slasher', 'serial killer', 'masked killer', 'massacre', 'stalker', 'final girl', 'body count'],
  HORROR_ZOMBIE: ['zombie', 'undead', 'living dead', 'walking dead', 'outbreak', 'infection', 'reanimated'],
  HORROR_BODY: ['body horror', 'body transformation', 'mutation', 'grotesque', 'flesh', 'cronenberg', 'metamorphosis', 'deformity', 'parasite'],
  HORROR_FOLK: ['folk horror', 'pagan', 'ritual', 'cult', 'rural horror', 'isolated community', 'wicker man', 'midsommar', 'ancient ritual', 'countryside terror'],
  HORROR_WITCH: ['witch', 'witchcraft', 'coven', 'black magic', 'salem', 'witches', 'sorceress', 'dark magic', 'curse'],
  HORROR_COSMIC: ['cosmic horror', 'lovecraft', 'lovecraftian', 'eldritch', 'cthulhu', 'unknowable', 'existential horror', 'cosmic dread', 'ancient evil', 'elder gods'],
  HORROR_OCCULT: ['occult', 'satanic', 'devil', 'demonic ritual', 'black mass', 'satanism', 'antichrist', 'lucifer', 'infernal'],
  HORROR_GOTHIC: ['gothic horror', 'gothic', 'dark castle', 'victorian horror', 'romantic horror', 'aristocratic horror', 'castle', 'manor'],
  HORROR_FOUND_FOOTAGE: ['found footage', 'mockumentary horror', 'handheld', 'documentary style', 'pov horror', 'first person'],
  HORROR_GIALLO: ['giallo', 'italian horror', 'stylized violence', 'argento', 'bava', 'murder mystery horror'],
  HORROR_REVENGE: ['revenge horror', 'home invasion', 'survival horror', 'last house', 'torture revenge', 'vigilante horror'],
  HORROR_MONSTER: ['monster', 'creature', 'beast', 'monster movie', 'creature feature'],
  HORROR_VAMPIRE: ['vampire', 'nosferatu', 'bloodsucker', 'dracula', 'vampiric', 'undead', 'immortal'],
  HORROR_WEREWOLF: ['werewolf', 'lycanthrope', 'transformation', 'wolf', 'full moon', 'lycanthropy'],
  HORROR_RELIGIOUS: ['religious horror', 'exorcism', 'biblical', 'apocalyptic horror', 'christian horror', 'demonic', 'the omen', 'prophecy'],
  HORROR_COMEDY: ['horror comedy', 'comedy horror', 'campy', 'splatter comedy', 'zom-com', 'funny horror'],
  HORROR_EXTREME: ['extreme horror', 'torture porn', 'disturbing', 'graphic violence', 'transgressive', 'brutal', 'shocking'],
  HORROR_ELEVATED: ['elevated horror', 'arthouse horror', 'prestige horror', 'slow burn horror', 'a24 horror', 'literary horror', 'art horror'],
  HORROR_ANALOG: ['analog horror', 'vhs aesthetic', 'broadcast horror', 'local 58', 'mandela catalogue', 'retro horror'],
  HORROR_SCIFI: ['sci-fi horror', 'space horror', 'alien horror', 'event horizon', 'science fiction horror'],
  HORROR_ECO: ['eco-horror', 'environmental horror', 'nature horror', 'plant horror', 'animal horror', 'ecological terror'],
  HORROR_TECH: ['techno horror', 'killer ai', 'evil technology', 'cyber horror', 'haunted technology', 'cursed video'],
  HORROR_HOLIDAY: ['holiday horror', 'christmas horror', 'halloween horror', 'krampus', 'black christmas'],
  HORROR_PERIOD: ['period horror', 'historical horror', 'medieval horror', 'victorian', 'colonial horror'],

  // ============================================
  // THRILLER SUBGENRES (15+)
  // ============================================
  THRILLER_PSYCHOLOGICAL: ['psychological thriller', 'mind games', 'unreliable narrator', 'twist ending', 'mental', 'paranoid thriller', 'manipulation'],
  THRILLER_CONSPIRACY: ['conspiracy', 'cover-up', 'paranoid thriller', 'deep state', 'secret organization', 'government conspiracy'],
  THRILLER_CRIME: ['crime thriller', 'detective', 'investigation', 'murder mystery', 'whodunit', 'police thriller', 'noir'],
  THRILLER_NEO_NOIR: ['neo-noir', 'noir', 'femme fatale', 'hard-boiled', 'neo noir', 'crime noir', 'dark thriller', 'moody'],
  THRILLER_LEGAL: ['legal thriller', 'courtroom thriller', 'lawyer', 'trial', 'legal drama', 'the firm'],
  THRILLER_POLITICAL: ['political thriller', 'government', 'assassination', 'political intrigue', 'washington', 'presidency'],
  THRILLER_EROTIC: ['erotic thriller', 'sensual', 'seduction', 'sexual thriller', 'noir romance', 'dangerous attraction'],
  THRILLER_SPY: ['spy thriller', 'espionage thriller', 'intelligence', 'cia', 'mi6', 'cold war thriller', 'spy game'],
  THRILLER_MEDICAL: ['medical thriller', 'virus', 'outbreak', 'epidemic', 'pandemic', 'hospital thriller', 'disease'],
  THRILLER_TECH: ['techno thriller', 'hacker', 'cyber thriller', 'technology', 'digital', 'surveillance'],
  THRILLER_DISASTER: ['disaster thriller', 'survival thriller', 'catastrophe', 'natural disaster', 'emergency'],
  THRILLER_FINANCIAL: ['financial thriller', 'wall street', 'corporate thriller', 'fraud', 'banking', 'white collar crime'],
  THRILLER_RELIGIOUS: ['religious thriller', 'da vinci code', 'church conspiracy', 'Vatican', 'religious mystery'],
  THRILLER_REVENGE: ['revenge thriller', 'vigilante', 'payback', 'retribution', 'vengeance thriller'],
  THRILLER_ACTION: ['action thriller', 'high octane', 'chase', 'explosive'],

  // ============================================
  // DRAMA SUBGENRES (20+)
  // ============================================
  DRAMA_PSYCHOLOGICAL: ['psychological drama', 'character study', 'internal conflict', 'mental health', 'emotional'],
  DRAMA_SURREAL: ['surreal', 'surrealism', 'dreamlike', 'abstract', 'david lynch', 'lynchian', 'avant-garde', 'experimental', 'bizarre', 'strange'],
  DRAMA_ARTHOUSE: ['arthouse', 'art house', 'experimental', 'avant-garde', 'art film', 'independent', 'auteur', 'festival film'],
  DRAMA_SLOW_BURN: ['slow burn', 'atmospheric', 'meditative', 'contemplative', 'deliberate pace', 'character driven'],
  DRAMA_HISTORICAL: ['historical', 'period piece', 'based on true story', 'biography', 'biopic', 'historical drama'],
  DRAMA_FAMILY: ['family drama', 'generational', 'dysfunctional family', 'family conflict', 'domestic drama', 'siblings'],
  DRAMA_COMING_OF_AGE: ['coming of age', 'teenager', 'adolescence', 'growing up', 'youth', 'high school', 'teen drama'],
  DRAMA_ROMANTIC: ['romantic drama', 'love story', 'romance', 'relationship', 'heartbreak', 'tragic love'],
  DRAMA_SOCIAL: ['social drama', 'social commentary', 'inequality', 'class struggle', 'poverty', 'social issues', 'realist'],
  DRAMA_COURTROOM: ['courtroom drama', 'trial', 'justice', 'legal drama', 'verdict', 'jury'],
  DRAMA_MEDICAL: ['medical drama', 'illness', 'doctor', 'hospital', 'disease', 'dying', 'terminal'],
  DRAMA_SPORTS: ['sports drama', 'underdog', 'championship', 'athlete', 'coach', 'team', 'competition'],
  DRAMA_WAR: ['war drama', 'anti-war', 'soldier', 'battlefield', 'military drama', 'veteran', 'ptsd'],
  DRAMA_POLITICAL: ['political drama', 'election', 'government', 'presidency', 'politics', 'power'],
  DRAMA_BIOGRAPHICAL: ['biography', 'biopic', 'true story', 'real life', 'based on', 'life story'],
  DRAMA_TRAGEDY: ['tragedy', 'tragic', 'downfall', 'greek tragedy', 'shakespearean', 'fate', 'doom'],
  DRAMA_MELODRAMA: ['melodrama', 'emotional', 'sentimental', 'weepy', 'tearjerker', 'romantic melodrama'],
  DRAMA_MUSICAL: ['musical drama', 'music', 'musician', 'singer', 'band', 'concert', 'performance'],
  DRAMA_EXISTENTIAL: ['existential', 'philosophical', 'meaning of life', 'nihilism', 'absurdist', 'identity crisis'],
  DRAMA_RELIGIOUS: ['religious drama', 'faith', 'spiritual', 'church', 'priest', 'crisis of faith'],
  DRAMA_PRISON: ['prison drama', 'incarceration', 'escape', 'penitentiary', 'death row', 'convict'],

  // ============================================
  // SCI-FI SUBGENRES (20+)
  // ============================================
  SCIFI_SPACE: ['space', 'spaceship', 'outer space', 'galaxy', 'planet', 'astronaut', 'space station', 'interstellar', 'star wars', 'star trek'],
  SCIFI_CYBERPUNK: ['cyberpunk', 'cyber', 'neon', 'hacker', 'corporate dystopia', 'blade runner', 'high tech low life', 'neural'],
  SCIFI_TIME_TRAVEL: ['time travel', 'time loop', 'time machine', 'parallel universe', 'alternate timeline', 'temporal', 'paradox'],
  SCIFI_ALIEN: ['alien', 'extraterrestrial', 'ufo', 'alien invasion', 'first contact', 'close encounters'],
  SCIFI_POST_APOCALYPTIC: ['post-apocalyptic', 'apocalypse', 'end of world', 'survival', 'wasteland', 'nuclear', 'fallout'],
  SCIFI_DYSTOPIA: ['dystopia', 'dystopian', 'authoritarian', 'totalitarian', 'orwellian', 'surveillance state', 'oppressive society'],
  SCIFI_UTOPIA: ['utopia', 'utopian', 'future society', 'idealistic', 'perfect world'],
  SCIFI_HARD: ['hard science fiction', 'hard sci-fi', 'realistic', 'physics', 'engineering', 'scientific accuracy'],
  SCIFI_SOFT: ['soft sci-fi', 'social science fiction', 'philosophical sci-fi', 'sociological'],
  SCIFI_SPACE_OPERA: ['space opera', 'epic', 'galactic', 'empire', 'rebellion', 'star wars', 'dune', 'epic space'],
  SCIFI_BIOPUNK: ['biopunk', 'genetic engineering', 'biotech', 'biotechnology', 'cloning', 'gattaca', 'dna'],
  SCIFI_STEAMPUNK: ['steampunk', 'victorian', 'clockwork', 'steam-powered', 'retro-futurism', 'airship'],
  SCIFI_DIESELPUNK: ['dieselpunk', 'retro-futurism', '1940s', 'art deco', 'diesel', 'pulp', 'noir sci-fi'],
  SCIFI_ROBOT: ['robot', 'android', 'ai', 'artificial intelligence', 'sentient machine', 'cyborg', 'automation'],
  SCIFI_VIRTUAL_REALITY: ['virtual reality', 'simulation', 'metaverse', 'matrix', 'vr', 'simulated world', 'digital reality'],
  SCIFI_KAIJU: ['kaiju', 'giant monster', 'godzilla', 'pacific rim', 'titan', 'colossal creature'],
  SCIFI_MILITARY: ['military sci-fi', 'space marines', 'starship troopers', 'space war', 'galactic military'],
  SCIFI_INVASION: ['alien invasion', 'war of the worlds', 'independence day', 'extraterrestrial threat', 'invasion'],
  SCIFI_TECH_NOIR: ['tech noir', 'future noir', 'neo-noir sci-fi', 'blade runner', 'dark city', 'moody sci-fi'],
  SCIFI_CLONE: ['clone', 'identity', 'duplicate', 'replicant', 'copy', 'multiplicity'],
  SCIFI_SOLARPUNK: ['solarpunk', 'eco-futurism', 'sustainable future', 'green technology', 'optimistic sci-fi'],

  // ============================================
  // COMEDY SUBGENRES (15+)
  // ============================================
  COMEDY_ROMANTIC: ['romantic comedy', 'rom-com', 'romance', 'love story', 'dating', 'meet cute'],
  COMEDY_DARK: ['dark comedy', 'black comedy', 'morbid humor', 'gallows humor', 'twisted comedy', 'macabre'],
  COMEDY_SATIRE: ['satire', 'political satire', 'social satire', 'satirical', 'lampoon', 'parody of society'],
  COMEDY_PARODY: ['parody', 'spoof', 'mockumentary', 'genre parody', 'send-up', 'pastiche'],
  COMEDY_SLAPSTICK: ['slapstick', 'physical comedy', 'farce', 'pratfall', 'visual gags', 'broad comedy'],
  COMEDY_BUDDY: ['buddy comedy', 'buddy cop', 'duo', 'odd couple', 'friendship', 'partners'],
  COMEDY_SCREWBALL: ['screwball comedy', 'witty', 'fast-paced dialogue', 'battle of sexes', 'madcap'],
  COMEDY_STONER: ['stoner comedy', 'marijuana', 'weed', 'pot', 'high', 'drug comedy'],
  COMEDY_ABSURD: ['absurd', 'surreal comedy', 'random', 'monty python', 'absurdist', 'non sequitur'],
  COMEDY_CRINGE: ['cringe comedy', 'awkward', 'embarrassing', 'uncomfortable humor', 'office style'],
  COMEDY_DRAMEDY: ['dramedy', 'tragicomedy', 'bittersweet', 'comedy drama', 'serious comedy'],
  COMEDY_ACTION: ['action comedy', 'comedy action', 'adventure comedy', 'funny action'],
  COMEDY_TEEN: ['teen comedy', 'high school comedy', 'coming of age comedy', 'youth comedy'],
  COMEDY_RAUNCHY: ['raunchy', 'crude', 'adult comedy', 'sex comedy', 'r-rated comedy', 'gross-out'],
  COMEDY_IMPROV: ['improvised', 'improv comedy', 'mockumentary', 'ad-libbed'],

  // ============================================
  // ACTION SUBGENRES (15+)
  // ============================================
  ACTION_SUPERHERO: ['superhero', 'super hero', 'marvel', 'dc comics', 'comic book', 'batman', 'superman', 'spider-man', 'avengers', 'x-men', 'justice league', 'mcu', 'dceu'],
  ACTION_SPY: ['spy', 'espionage', 'secret agent', 'james bond', '007', 'cia', 'mi6', 'intelligence', 'undercover'],
  ACTION_MILITARY: ['military', 'war action', 'soldier', 'navy seal', 'special forces', 'combat', 'battlefield', 'army'],
  ACTION_MARTIAL_ARTS: ['martial arts', 'kung fu', 'karate', 'taekwondo', 'mixed martial arts', 'mma', 'fighting', 'wuxia'],
  ACTION_HEIST: ['heist', 'robbery', 'bank robbery', 'con artist', 'theft', 'stealing', 'caper', 'ocean\'s'],
  ACTION_CAR_CHASE: ['car chase', 'racing', 'fast cars', 'street racing', 'vehicles', 'fast and furious', 'motorcar'],
  ACTION_DISASTER: ['disaster', 'earthquake', 'tsunami', 'volcano', 'natural disaster', 'catastrophe'],
  ACTION_BUDDY_COP: ['buddy cop', 'police partners', 'lethal weapon', 'cop duo', 'mismatched partners'],
  ACTION_REVENGE: ['revenge', 'vengeance', 'payback', 'john wick', 'vigilante', 'retribution'],
  ACTION_MERCENARY: ['mercenary', 'soldier of fortune', 'guns for hire', 'expendables', 'rambo'],
  ACTION_SWASHBUCKLER: ['swashbuckler', 'pirate', 'sword fighting', 'musketeer', 'adventure', 'pirates'],
  ACTION_WESTERN: ['western', 'cowboy', 'frontier', 'wild west', 'gunslinger', 'outlaw'],
  ACTION_GUNPLAY: ['gunplay', 'shootout', 'gun fu', 'john woo', 'heroic bloodshed', 'balletic action'],
  ACTION_PARKOUR: ['parkour', 'free running', 'chase', 'athletic', 'stunts'],

  // ============================================
  // ANIMATION SUBGENRES
  // ============================================
  ANIME_SCIFI: ['anime', 'japanese animation', 'anime sci-fi'],
  ANIME_MECHA: ['mecha', 'giant robot', 'gundam', 'evangelion', 'robot anime'],
  ANIME_SHONEN: ['shonen', 'battle anime', 'action anime', 'dragon ball', 'naruto'],
  ANIME_SEINEN: ['seinen', 'mature anime', 'adult anime'],
  ANIME_SLICE_OF_LIFE: ['slice of life', 'everyday life', 'iyashikei', 'relaxing anime'],
  ANIME_ISEKAI: ['isekai', 'transported to another world', 'fantasy world'],
  ANIMATION_PIXAR: ['pixar', 'disney animation', 'family animation', 'cg animation'],
  ANIMATION_STOP_MOTION: ['stop motion', 'claymation', 'puppet animation', 'laika'],
  ANIMATION_ADULT: ['adult animation', 'mature animation', 'not for kids'],

  // ============================================
  // DOCUMENTARY SUBGENRES
  // ============================================
  DOC_TRUE_CRIME: ['true crime', 'murder documentary', 'serial killer doc', 'crime documentary', 'investigation'],
  DOC_NATURE: ['nature documentary', 'wildlife', 'planet earth', 'animal', 'nature'],
  DOC_MUSIC: ['music documentary', 'concert film', 'band documentary', 'musician'],
  DOC_SPORTS: ['sports documentary', 'athlete', 'team', 'championship', 'athletic'],
  DOC_POLITICAL: ['political documentary', 'social documentary', 'activist', 'exposé'],
  DOC_FOOD: ['food documentary', 'chef', 'cooking', 'cuisine', 'restaurant'],
  DOC_TRAVEL: ['travel documentary', 'journey', 'expedition', 'exploration'],
  DOC_HISTORICAL: ['historical documentary', 'history', 'war documentary', 'historical event'],

  // ============================================
  // ROMANCE SUBGENRES
  // ============================================
  ROMANCE_PERIOD: ['period romance', 'historical romance', 'regency', 'jane austen', 'costume drama'],
  ROMANCE_TRAGIC: ['tragic romance', 'doomed love', 'star-crossed lovers', 'sad romance'],
  ROMANCE_LGBTQ: ['lgbtq romance', 'gay romance', 'lesbian romance', 'queer love', 'same-sex romance'],
  ROMANCE_INTERRACIAL: ['interracial romance', 'multicultural love', 'cross-cultural'],
  ROMANCE_FANTASY: ['fantasy romance', 'supernatural romance', 'paranormal romance'],

  // ============================================
  // FANTASY SUBGENRES
  // ============================================
  FANTASY_EPIC: ['epic fantasy', 'high fantasy', 'lord of the rings', 'tolkien', 'quest', 'chosen one'],
  FANTASY_DARK: ['dark fantasy', 'grimdark', 'dark magic', 'grim fantasy', 'mature fantasy'],
  FANTASY_URBAN: ['urban fantasy', 'contemporary fantasy', 'magic in modern world', 'hidden magical world'],
  FANTASY_FAIRY_TALE: ['fairy tale', 'fairytale', 'storybook', 'once upon a time', 'enchanted'],
  FANTASY_SWORD_SORCERY: ['sword and sorcery', 'conan', 'barbarian', 'adventure fantasy'],
  FANTASY_MYTHOLOGICAL: ['mythological', 'greek mythology', 'norse mythology', 'legends', 'gods'],
};

/**
 * Detect detailed subgenre patterns from user's watch history
 */
export function analyzeSubgenrePatterns(films: Array<{
  title: string;
  genres?: string[];
  keywords?: string[];
  keywordIds?: number[]; // NEW: ID-based detection
  rating?: number;
  liked?: boolean;
}>): Map<string, SubgenrePattern> {

  const patterns = new Map<string, SubgenrePattern>();

  // Initialize patterns for each major genre
  const majorGenres = ['Action', 'Science Fiction', 'Horror', 'Comedy', 'Drama', 'Thriller'];

  for (const genre of majorGenres) {
    patterns.set(genre, {
      parentGenre: genre,
      subgenres: new Map(),
      avoidedSubgenres: new Set(),
      preferredSubgenres: new Set()
    });
  }

  // Analyze each film
  for (const film of films) {
    const genres = film.genres || [];
    const keywords = film.keywords || [];
    const allText = [film.title.toLowerCase(), ...keywords.map(k => k.toLowerCase())].join(' ');

    const rating = film.rating ?? 0;
    const isLiked = film.liked || rating >= 4;
    const isDisliked = !film.liked && rating < 3;

    // Check each major genre the film belongs to
    for (const genre of genres) {
      const pattern = patterns.get(genre);
      if (!pattern) continue;

      // Detect subgenres based on keywords (both text and IDs)
      const detectedSubgenres = detectSubgenres(genre, allText, keywords, film.keywordIds);

      for (const subgenre of detectedSubgenres) {
        // Initialize subgenre stats
        if (!pattern.subgenres.has(subgenre)) {
          pattern.subgenres.set(subgenre, {
            watched: 0,
            liked: 0,
            avgRating: 0,
            weight: 0
          });
        }

        const stats = pattern.subgenres.get(subgenre)!;
        stats.watched++;

        if (isLiked) {
          stats.liked++;
          stats.weight += rating >= 4.5 ? 2.0 : 1.5;
        } else if (isDisliked) {
          stats.weight += 0; // Don't add weight for disliked
        } else {
          stats.weight += 0.5; // Neutral
        }

        // Update average rating
        if (rating > 0) {
          stats.avgRating = ((stats.avgRating * (stats.watched - 1)) + rating) / stats.watched;
        }
      }
    }
  }

  // Determine preferred and avoided subgenres (VERY conservative thresholds)
  for (const [genre, pattern] of patterns.entries()) {
    const totalWatched = Array.from(pattern.subgenres.values()).reduce((sum, s) => sum + s.watched, 0);

    if (totalWatched === 0) continue;

    for (const [subgenre, stats] of pattern.subgenres.entries()) {
      const likeRatio = stats.liked / stats.watched;
      const watchRatio = stats.watched / totalWatched;

      // Preferred: watched a lot AND liked
      if (watchRatio >= 0.15 && likeRatio >= 0.6) {
        pattern.preferredSubgenres.add(subgenre);
      }

      // Avoided: ONLY if we have STRONG evidence of active dislike
      // REMOVED: the "rarely watched" condition - that's not evidence of dislike!
      // A user not watching many spy movies doesn't mean they AVOID spy movies
      // 
      // New criteria: Must have watched at least 10 films AND actively disliked most (< 20% like ratio)
      // This ensures we only filter subgenres the user has TRIED and consistently disliked
      if (stats.watched >= 10 && likeRatio < 0.2) {
        pattern.avoidedSubgenres.add(subgenre);
      }
    }
  }

  return patterns;
}

/**
 * Detect specific subgenres from text and keyword IDs
 */
export function detectSubgenres(
  genre: string,
  text: string,
  keywords: string[],
  keywordIds: number[] = []
): Set<string> {
  const detected = new Set<string>();
  const keywordsLower = keywords.map(k => k.toLowerCase());

  // 1. Check ID-based matches (Most accurate)
  if (keywordIds && keywordIds.length > 0) {
    for (const id of keywordIds) {
      const subgenreKey = getSubgenreFromKeywordId(id);
      if (subgenreKey) {
        // Only accept if it matches the parent genre we are analyzing
        // e.g. if we are looking at "Horror" patterns, only accept HORROR_XXX subgenres
        // unless it's a known cross-over like SCIFI_BIOPUNK matching in Horror context?
        // Actually, users might associate "Body Horror" (HORROR_BODY) with Sci-Fi.
        // For simplicity, strict prefix matching for now, OR rely on the mapping to be correct.

        // Strict check: does the subgenre key start with the genre name? 
        // e.g. HORROR_FOLK starts with HORROR.
        // But what about 'Science Fiction'? key is SCIFI_.

        const normalizedGenreStr = genre.toUpperCase().replace('SCIENCE FICTION', 'SCIFI').replace(/[^A-Z]/g, '');
        const subgenrePrefix = subgenreKey.split('_')[0]; // HORROR, SCIFI, THRILLER, ACTION, etc.

        // Allow match if prefix matches genre, OR some specific cross-overs
        if (subgenreKey.startsWith(normalizedGenreStr)) {
          detected.add(subgenreKey);
        }
      }
    }
  }

  // 2. Fallback to text matching
  // Check against subgenre keyword mappings
  const normalizedGenreStr = genre.toUpperCase().replace('SCIENCE FICTION', 'SCIFI').replace(/[^A-Z]/g, '');
  const relevantMappings = Object.entries(SUBGENRE_KEYWORDS).filter(([key]) =>
    key.startsWith(normalizedGenreStr)
  );

  for (const [subgenreKey, subgenreKeywords] of relevantMappings) {
    const matches = subgenreKeywords.some(kw =>
      text.includes(kw.toLowerCase()) || keywordsLower.some(k => k.includes(kw.toLowerCase()))
    );

    if (matches) {
      detected.add(subgenreKey);
    }
  }

  return detected;
}

/**
 * Analyze cross-genre patterns (e.g., Action+Thriller with spy themes)
 */
export function analyzeCrossGenrePatterns(films: Array<{
  title: string;
  genres?: string[];
  keywords?: string[];
  rating?: number;
  liked?: boolean;
}>): Map<string, CrossGenrePattern> {

  const patterns = new Map<string, CrossGenrePattern>();

  for (const film of films) {
    const genres = (film.genres || []).sort();
    const keywords = film.keywords || [];
    const rating = film.rating ?? 0;
    const isLiked = film.liked || rating >= 4;

    // Skip if not liked/rated
    if (!isLiked && rating < 3) continue;

    // Create genre combination key
    if (genres.length >= 2) {
      const combo = genres.slice(0, 3).join('+'); // Max 3 genres

      if (!patterns.has(combo)) {
        patterns.set(combo, {
          combination: combo,
          keywords: new Set(),
          watched: 0,
          liked: 0,
          avgRating: 0,
          weight: 0,
          examples: []
        });
      }

      const pattern = patterns.get(combo)!;
      pattern.watched++;

      if (isLiked) pattern.liked++;
      if (rating > 0) {
        pattern.avgRating = ((pattern.avgRating * (pattern.watched - 1)) + rating) / pattern.watched;
      }

      // Weight calculation
      if (rating >= 4.5) {
        pattern.weight += isLiked ? 2.0 : 1.5;
      } else if (rating >= 3.5) {
        pattern.weight += isLiked ? 1.5 : 1.0;
      }

      // Add keywords
      keywords.forEach(kw => pattern.keywords.add(kw.toLowerCase()));

      // Add example
      if (pattern.examples.length < 3) {
        pattern.examples.push(film.title);
      }
    }
  }

  return patterns;
}

/**
 * Check if a candidate movie should be filtered based on subgenre patterns
 */
export function shouldFilterBySubgenre(
  candidateGenres: string[],
  candidateKeywords: string[],
  candidateKeywordIds: number[], // NEW
  candidateTitle: string,
  subgenrePatterns: Map<string, SubgenrePattern>
): { shouldFilter: boolean; reason?: string } {

  // Defensive checks
  if (!Array.isArray(candidateGenres) || !Array.isArray(candidateKeywords)) {
    console.warn('[SubgenreFilter] Invalid input: genres or keywords not arrays', { candidateGenres, candidateKeywords });
    return { shouldFilter: false };
  }

  const allText = [candidateTitle.toLowerCase(), ...candidateKeywords.map((k: string) => k.toLowerCase())].join(' ');

  for (const genre of candidateGenres) {
    const pattern = subgenrePatterns.get(genre);
    if (!pattern) continue;

    // Detect subgenres in candidate
    const candidateSubgenres = detectSubgenres(genre, allText, candidateKeywords, candidateKeywordIds);

    // Check if any detected subgenre is avoided
    for (const subgenre of candidateSubgenres) {
      if (pattern.avoidedSubgenres.has(subgenre)) {
        const subgenreName = subgenre.replace(/_/g, ' ').toLowerCase();
        return {
          shouldFilter: true,
          reason: `User avoids ${subgenreName} within ${genre}`
        };
      }
    }
  }

  return { shouldFilter: false };
}

/**
 * Boost score if candidate matches preferred cross-genre patterns
 */
export function boostForCrossGenreMatch(
  candidateGenres: string[],
  candidateKeywords: string[],
  crossGenrePatterns: Map<string, CrossGenrePattern>
): { boost: number; reason?: string } {

  // Defensive checks
  if (!Array.isArray(candidateGenres) || !Array.isArray(candidateKeywords)) {
    console.warn('[CrossGenreBoost] Invalid input: genres or keywords not arrays', { candidateGenres, candidateKeywords });
    return { boost: 0 };
  }

  // Check for matching genre combinations
  const sortedGenres = candidateGenres.slice().sort();
  const candidateKeywordSet = new Set(candidateKeywords.map((k: string) => k.toLowerCase()));

  let maxBoost = 0;
  let bestReason = '';

  for (let i = 2; i <= Math.min(3, sortedGenres.length); i++) {
    const combo = sortedGenres.slice(0, i).join('+');
    const pattern = crossGenrePatterns.get(combo);

    if (!pattern) continue;
    if (pattern.watched < 3) continue; // Need significant sample

    // Check keyword overlap
    const keywordMatches = Array.from(pattern.keywords).filter(kw =>
      candidateKeywordSet.has(kw)
    );

    if (keywordMatches.length > 0) {
      // Calculate boost based on pattern strength and keyword matches
      const boost = (pattern.weight / pattern.watched) * (1 + (keywordMatches.length * 0.2));

      if (boost > maxBoost) {
        maxBoost = boost;
        const exampleFilms = pattern.examples.slice(0, 2).join(', ');
        bestReason = `Matches your taste in ${combo} with themes: ${keywordMatches.slice(0, 3).join(', ')} (like ${exampleFilms})`;
      }
    }
  }

  return { boost: maxBoost, reason: bestReason };
}

/**
 * Generate human-readable subgenre preference report
 */
export function generateSubgenreReport(patterns: Map<string, SubgenrePattern>): string {
  const lines: string[] = [];

  for (const [genre, pattern] of patterns.entries()) {
    if (pattern.preferredSubgenres.size === 0 && pattern.avoidedSubgenres.size === 0) continue;

    lines.push(`\n${genre}:`);

    if (pattern.preferredSubgenres.size > 0) {
      lines.push(`  ✅ Prefers: ${Array.from(pattern.preferredSubgenres).map(s => s.replace(/_/g, ' ').toLowerCase()).join(', ')}`);
    }

    if (pattern.avoidedSubgenres.size > 0) {
      lines.push(`  ❌ Avoids: ${Array.from(pattern.avoidedSubgenres).map(s => s.replace(/_/g, ' ').toLowerCase()).join(', ')}`);
    }
  }

  return lines.join('\n');
}
