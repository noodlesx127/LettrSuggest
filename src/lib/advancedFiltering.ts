/**
 * Advanced Filtering for Movie Suggestions
 * Applies subgenre-level filtering and cross-genre boost logic
 */

import { type TMDBMovie } from './enrich';
import { type EnhancedTasteProfile } from './enhancedProfile';
import { 
  shouldFilterBySubgenre, 
  boostForCrossGenreMatch,
  generateSubgenreReport 
} from './subgenreDetection';

export type FilterResult = {
  shouldFilter: boolean;
  reason?: string;
  boost?: number;
  boostReason?: string;
};

/**
 * Apply advanced filtering to a candidate movie based on user's nuanced preferences
 * Returns whether to filter (exclude) the movie and any score boosts
 */
export function applyAdvancedFiltering(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile
): FilterResult {
  
  const genres = candidate.genres?.map(g => g.name) || [];
  const keywords = (candidate as any).keywords?.map((k: any) => k.name) || [];
  const title = candidate.title || '';
  
  // Step 1: Check for subgenre avoidance
  // E.g., user likes Action but avoids Superhero Action
  const subgenreCheck = shouldFilterBySubgenre(
    genres,
    keywords,
    title,
    profile.subgenrePatterns
  );
  
  if (subgenreCheck.shouldFilter) {
    console.log(`[AdvancedFilter] Filtering "${title}" - ${subgenreCheck.reason}`);
    return {
      shouldFilter: true,
      reason: subgenreCheck.reason
    };
  }
  
  // Step 2: Check for cross-genre pattern match
  // E.g., user loves Action+Thriller with spy themes
  const crossGenreBoost = boostForCrossGenreMatch(
    genres,
    keywords,
    profile.crossGenrePatterns
  );
  
  if (crossGenreBoost.boost > 0) {
    console.log(`[AdvancedFilter] Boosting "${title}" by ${crossGenreBoost.boost.toFixed(2)} - ${crossGenreBoost.reason}`);
  }
  
  return {
    shouldFilter: false,
    boost: crossGenreBoost.boost,
    boostReason: crossGenreBoost.reason
  };
}

/**
 * Apply negative filtering for explicitly disliked patterns
 */
export function applyNegativeFiltering(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile
): { shouldFilter: boolean; reason?: string } {
  
  const genres = candidate.genres?.map(g => g.name) || [];
  const keywords = (candidate as any).keywords?.map((k: any) => k.name) || [];
  const genreCombo = genres.slice(0, 2).sort().join('+');
  
  // Check avoided genre combinations
  if (profile.avoidedGenreCombos.has(genreCombo)) {
    return {
      shouldFilter: true,
      reason: `User avoids genre combo: ${genreCombo}`
    };
  }
  
  // Check avoided keywords (with threshold)
  const matchedAvoidedKeywords = keywords.filter((k: string) => profile.avoidedKeywords.has(k));
  if (matchedAvoidedKeywords.length >= 2) {
    return {
      shouldFilter: true,
      reason: `User avoids keywords: ${matchedAvoidedKeywords.slice(0, 2).join(', ')}`
    };
  }
  
  return { shouldFilter: false };
}

/**
 * Check if candidate matches user's niche preferences
 * Returns false (should filter) if candidate is in a niche the user avoids
 */
export function checkNicheCompatibility(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile
): { compatible: boolean; reason?: string } {
  
  const genres = candidate.genres?.map(g => g.name) || [];
  const keywords = (candidate as any).keywords?.map((k: any) => k.name) || [];
  const allText = [candidate.title?.toLowerCase() || '', ...keywords.map((k: string) => k.toLowerCase())].join(' ');
  
  // Check Anime
  const isAnime = genres.some(g => g.toLowerCase().includes('anime')) || 
                  allText.includes('anime') || 
                  allText.includes('japanese animation');
  
  if (isAnime && !profile.nichePreferences.likesAnime) {
    return {
      compatible: false,
      reason: 'User has not shown interest in anime'
    };
  }
  
  // Check Stand-Up Comedy
  const isStandUp = allText.includes('stand-up') || 
                    allText.includes('stand up comedy') ||
                    allText.includes('comedian');
  
  if (isStandUp && !profile.nichePreferences.likesStandUp) {
    return {
      compatible: false,
      reason: 'User has not shown interest in stand-up comedy'
    };
  }
  
  // Check Food Documentaries
  const isFoodDoc = (genres.includes('Documentary') && 
                     (allText.includes('food') || allText.includes('cooking') || 
                      allText.includes('chef') || allText.includes('restaurant')));
  
  if (isFoodDoc && !profile.nichePreferences.likesFoodDocs) {
    return {
      compatible: false,
      reason: 'User has not shown interest in food documentaries'
    };
  }
  
  // Check Travel Documentaries
  const isTravelDoc = (genres.includes('Documentary') && 
                       (allText.includes('travel') || allText.includes('journey') || 
                        allText.includes('explorer') || allText.includes('adventure documentary')));
  
  if (isTravelDoc && !profile.nichePreferences.likesTravelDocs) {
    return {
      compatible: false,
      reason: 'User has not shown interest in travel documentaries'
    };
  }
  
  return { compatible: true };
}

/**
 * Check runtime compatibility with user's preferences
 */
export function checkRuntimeCompatibility(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile
): { compatible: boolean; reason?: string } {
  
  const runtime = (candidate as any).runtime || 0;
  
  if (runtime === 0) return { compatible: true };
  
  const { min, max, avg } = profile.runtimePreferences;
  
  // If user has consistent runtime preferences, be strict
  if (max > 0 && (max - min) < 60) {
    // User watches movies in a tight runtime range
    const tolerance = 30; // 30 minutes tolerance
    
    if (runtime < (avg - tolerance) || runtime > (avg + tolerance)) {
      return {
        compatible: false,
        reason: `Runtime (${runtime}min) outside user's typical range (${avg.toFixed(0)}±${tolerance}min)`
      };
    }
  }
  
  return { compatible: true };
}

/**
 * Generate human-readable filtering report for debugging
 */
export function generateFilteringReport(profile: EnhancedTasteProfile): string {
  const lines: string[] = [
    '=== Advanced Filtering Report ===',
    '',
    '📊 Subgenre Intelligence:',
    generateSubgenreReport(profile.subgenrePatterns),
    '',
    '🔗 Cross-Genre Patterns:',
  ];
  
  const topCrossPatterns = Array.from(profile.crossGenrePatterns.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5);
  
  for (const [combo, pattern] of topCrossPatterns) {
    const keywordSample = Array.from(pattern.keywords).slice(0, 3).join(', ');
    lines.push(`  ✅ ${combo}: ${pattern.watched} watched, keywords: ${keywordSample}`);
    lines.push(`     Examples: ${pattern.examples.join(', ')}`);
  }
  
  lines.push('');
  lines.push('🚫 Avoidance Patterns:');
  lines.push(`  Avoided Genre Combos: ${Array.from(profile.avoidedGenreCombos).slice(0, 5).join(', ') || 'none'}`);
  lines.push(`  Avoided Keywords: ${Array.from(profile.avoidedKeywords).slice(0, 5).join(', ') || 'none'}`);
  
  lines.push('');
  lines.push('🎯 Niche Preferences:');
  lines.push(`  Anime: ${profile.nichePreferences.likesAnime ? '✅ Yes' : '❌ No'}`);
  lines.push(`  Stand-Up: ${profile.nichePreferences.likesStandUp ? '✅ Yes' : '❌ No'}`);
  lines.push(`  Food Docs: ${profile.nichePreferences.likesFoodDocs ? '✅ Yes' : '❌ No'}`);
  lines.push(`  Travel Docs: ${profile.nichePreferences.likesTravelDocs ? '✅ Yes' : '❌ No'}`);
  
  lines.push('');
  lines.push('⏱️ Runtime Preferences:');
  lines.push(`  Range: ${profile.runtimePreferences.min}-${profile.runtimePreferences.max} min`);
  lines.push(`  Average: ${profile.runtimePreferences.avg.toFixed(0)} min`);
  
  return lines.join('\n');
}
