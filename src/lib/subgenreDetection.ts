/**
 * Advanced Subgenre Detection and Cross-Genre Pattern Analysis
 * Detects nuanced preferences like "action but not superhero" or "sci-fi space but not anime sci-fi"
 */

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
 */
export const SUBGENRE_KEYWORDS = {
  // Action subgenres
  ACTION_SUPERHERO: ['superhero', 'super hero', 'marvel', 'dc comics', 'comic book', 'batman', 'superman', 'spider-man', 'avengers', 'x-men', 'justice league', 'mcu', 'dceu'],
  ACTION_SPY: ['spy', 'espionage', 'secret agent', 'james bond', '007', 'cia', 'mi6', 'intelligence', 'undercover'],
  ACTION_MILITARY: ['military', 'war action', 'soldier', 'navy seal', 'special forces', 'combat', 'battlefield'],
  ACTION_MARTIAL_ARTS: ['martial arts', 'kung fu', 'karate', 'taekwondo', 'mixed martial arts', 'mma', 'fighting'],
  ACTION_HEIST: ['heist', 'robbery', 'bank robbery', 'con artist', 'theft', 'stealing'],
  ACTION_CAR_CHASE: ['car chase', 'racing', 'fast cars', 'street racing', 'vehicles'],
  ACTION_DISASTER: ['disaster', 'earthquake', 'tsunami', 'volcano', 'natural disaster'],
  
  // Sci-Fi subgenres
  SCIFI_SPACE: ['space', 'spaceship', 'outer space', 'galaxy', 'planet', 'astronaut', 'space station', 'interstellar', 'star wars', 'star trek'],
  SCIFI_CYBERPUNK: ['cyberpunk', 'dystopia', 'cyber', 'virtual reality', 'artificial intelligence', 'robot', 'cyborg', 'android'],
  SCIFI_TIME_TRAVEL: ['time travel', 'time loop', 'time machine', 'parallel universe', 'alternate timeline'],
  SCIFI_ALIEN: ['alien', 'extraterrestrial', 'ufo', 'alien invasion', 'first contact'],
  SCIFI_POST_APOCALYPTIC: ['post-apocalyptic', 'apocalypse', 'end of world', 'survival', 'wasteland'],
  SCIFI_HARD_SCIFI: ['hard science fiction', 'scientific', 'physics', 'quantum'],
  
  // Horror subgenres
  HORROR_SUPERNATURAL: ['supernatural', 'ghost', 'demon', 'possession', 'haunted', 'paranormal', 'spirit'],
  HORROR_SLASHER: ['slasher', 'serial killer', 'masked killer', 'massacre'],
  HORROR_ZOMBIE: ['zombie', 'undead', 'living dead', 'walking dead'],
  HORROR_PSYCHOLOGICAL: ['psychological horror', 'mind games', 'psychological thriller'],
  HORROR_MONSTER: ['monster', 'creature', 'beast'],
  HORROR_FOUND_FOOTAGE: ['found footage', 'documentary style'],
  
  // Comedy subgenres
  COMEDY_ROMANTIC: ['romantic comedy', 'rom-com', 'romance'],
  COMEDY_DARK: ['dark comedy', 'black comedy', 'satire', 'satirical'],
  COMEDY_SLAPSTICK: ['slapstick', 'physical comedy', 'farce'],
  COMEDY_PARODY: ['parody', 'spoof', 'mockumentary'],
  COMEDY_BUDDY: ['buddy comedy', 'buddy cop', 'friendship'],
  
  // Drama subgenres
  DRAMA_HISTORICAL: ['historical', 'period piece', 'based on true story', 'biography', 'biopic'],
  DRAMA_LEGAL: ['legal', 'courtroom', 'lawyer', 'trial'],
  DRAMA_MEDICAL: ['medical', 'hospital', 'doctor', 'disease'],
  DRAMA_SPORTS: ['sports', 'athlete', 'championship', 'competition'],
  DRAMA_POLITICAL: ['political', 'politics', 'government', 'election'],
  DRAMA_FAMILY: ['family drama', 'coming of age', 'teenager', 'high school'],
  
  // Thriller subgenres
  THRILLER_PSYCHOLOGICAL: ['psychological', 'mind', 'mental'],
  THRILLER_CONSPIRACY: ['conspiracy', 'cover-up', 'secret organization'],
  THRILLER_CRIME: ['crime', 'detective', 'investigation', 'murder mystery'],
  
  // Animation/Anime crossovers
  ANIME_SCIFI: ['anime', 'japanese animation'] // When combined with sci-fi
};

/**
 * Detect detailed subgenre patterns from user's watch history
 */
export function analyzeSubgenrePatterns(films: Array<{
  title: string;
  genres?: string[];
  keywords?: string[];
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
      
      // Detect subgenres based on keywords
      const detectedSubgenres = detectSubgenresFromText(genre, allText, keywords);
      
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
  
  // Determine preferred and avoided subgenres (more conservative thresholds)
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
      
      // Avoided: ONLY if we have strong evidence (more conservative)
      // Require at least 10 watches AND low like ratio < 0.2
      // OR very rarely watched (< 3% of total) with at least 30 total watched
      if ((stats.watched >= 10 && likeRatio < 0.2) || (watchRatio < 0.03 && totalWatched >= 30)) {
        pattern.avoidedSubgenres.add(subgenre);
      }
    }
  }
  
  return patterns;
}

/**
 * Detect specific subgenres from text and keywords
 */
function detectSubgenresFromText(genre: string, text: string, keywords: string[]): Set<string> {
  const detected = new Set<string>();
  const keywordsLower = keywords.map(k => k.toLowerCase());
  
  // Check against subgenre keyword mappings
  const relevantMappings = Object.entries(SUBGENRE_KEYWORDS).filter(([key]) => 
    key.startsWith(genre.toUpperCase().replace(' ', ''))
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
    const candidateSubgenres = detectSubgenresFromText(genre, allText, candidateKeywords);
    
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
