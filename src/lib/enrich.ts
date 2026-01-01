import { supabase } from './supabaseClient';
import { searchMovies } from './movieAPI';
import {
  analyzeSubgenrePatterns,
  analyzeCrossGenrePatterns,
  shouldFilterBySubgenre,
  detectSubgenres,
  stringHash, // ADDED
  boostForCrossGenreMatch,
  type SubgenrePattern,
  type CrossGenrePattern
} from './subgenreDetection';
import { checkNicheCompatibility } from './advancedFiltering';
import { getTuiMDBMovie, type TuiMDBMovie } from './tuimdb';
import { mergeEnhancedGenres, getCurrentSeasonalGenres, boostSeasonalGenres } from './genreEnhancement';
import { updateExplorationStats } from './adaptiveLearning';

/**
 * Helper to get the base URL for internal API calls
 */
function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

// Normalize a numeric signal into a user-facing strength label
function reasonStrengthLabel(strength: number): string {
  if (strength >= 3.5) return 'High';
  if (strength >= 2.0) return 'Solid';
  return 'Light';
}

export type TMDBMovie = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  genres?: Array<{ id: number; name: string }>;
  production_companies?: Array<{ id: number; name: string; logo_path?: string }>;
  credits?: { cast?: Array<{ id: number; name: string; known_for_department?: string; order?: number }>; crew?: Array<{ id: number; name: string; job?: string; department?: string }> };
  keywords?: { keywords?: Array<{ id: number; name: string }>; results?: Array<{ id: number; name: string }> };
  belongs_to_collection?: { id: number; name: string; poster_path?: string; backdrop_path?: string } | null;
  videos?: { results?: Array<{ id: string; key: string; site: string; type: string; name: string; official?: boolean }> };
  images?: { backdrops?: Array<{ file_path: string; vote_average?: number }>; posters?: Array<{ file_path: string; vote_average?: number }> };
  lists?: { results?: Array<{ id: number; name: string; description?: string; item_count?: number }> };
  tuimdb_uid?: number; // TuiMDB's internal UID for cross-referencing
  enhanced_genres?: Array<{ id: number; name: string; source: 'tmdb' | 'tuimdb' }>; // Merged TMDB + TuiMDB genres
  imdb_id?: string; // IMDB ID from TMDB (e.g., "tt0111161")
};

/**
 * Search for movies using unified API (tries TuiMDB first to get UIDs, then TMDB)
 */
export async function searchTmdb(query: string, year?: number) {
  console.log('[MovieAPI] search start', { query, year });
  try {
    const results = await searchMovies({ query, year, preferTuiMDB: true });
    console.log('[MovieAPI] search ok', { count: results.length });
    return results;
  } catch (e) {
    console.error('[MovieAPI] search exception', e);
    throw e;
  }
}

/**
 * Fetch a movie or TV show by TMDB ID
 * Supports both movies and TV shows, with field normalization for TV
 */
export async function fetchMovieById(id: number, mediaType: 'movie' | 'tv' = 'movie'): Promise<TMDBMovie | null> {
  console.log('[MovieAPI] fetchById start', { id, mediaType });
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
    if (!apiKey) {
      // Try fetching via API route instead
      const baseUrl = getBaseUrl();
      const url = new URL(`/api/tmdb/movie`, baseUrl);
      url.searchParams.set('id', String(id));
      url.searchParams.set('mediaType', mediaType);

      const r = await fetch(url.toString());
      const j = await r.json();

      if (r.ok && j.ok && j.movie) {
        return j.movie;
      }
      console.error('[MovieAPI] fetchById API route failed', j);
      return null;
    }

    // Direct TMDB API call
    const endpoint = mediaType === 'tv'
      ? `https://api.themoviedb.org/3/tv/${id}`
      : `https://api.themoviedb.org/3/movie/${id}`;

    const tmdbUrl = new URL(endpoint);
    tmdbUrl.searchParams.set('api_key', apiKey);
    tmdbUrl.searchParams.set('append_to_response', 'credits,keywords');

    const r = await fetch(tmdbUrl.toString());
    if (!r.ok) {
      console.error('[MovieAPI] fetchById TMDB error', { status: r.status });
      return null;
    }

    const data = await r.json();

    // Normalize TV show fields to match movie format
    if (mediaType === 'tv') {
      return {
        ...data,
        title: data.title || data.name,
        release_date: data.release_date || data.first_air_date,
        media_type: 'tv',
      };
    }

    return { ...data, media_type: 'movie' };
  } catch (e) {
    console.error('[MovieAPI] fetchById exception', e);
    return null;
  }
}

export async function upsertTmdbCache(movie: TMDBMovie) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('tmdb_movies').upsert({ tmdb_id: movie.id, data: movie }, { onConflict: 'tmdb_id' });
  if (error) {
    console.error('[Supabase] upsertTmdbCache error', { tmdbId: movie.id, error });
    throw error;
  }
}

export async function upsertFilmMapping(userId: string, uri: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('film_tmdb_map').upsert({ user_id: userId, uri, tmdb_id: tmdbId }, { onConflict: 'user_id,uri' });
  if (error) {
    console.error('[Supabase] upsertFilmMapping error', { userId, uri, tmdbId, error });
    throw error;
  }
}

export async function getFilmMappings(userId: string, uris: string[]) {
  if (!supabase) throw new Error('Supabase not initialized');
  if (!uris.length) return new Map<string, number>();

  // First verify auth is working
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      console.error('[Mappings] No active session - cannot fetch mappings');
      return new Map<string, number>();
    }
    console.log('[Mappings] Auth verified', { uid: sessionData.session.user.id });
  } catch (e) {
    console.error('[Mappings] Auth check failed', e);
    return new Map<string, number>();
  }

  // Instead of chunking by URIs (which can hit query size limits),
  // fetch ALL mappings for this user (with pagination), then filter in memory
  console.log('[Mappings] fetching all mappings for user', { userId, uriCount: uris.length });
  const map = new Map<string, number>();

  try {
    // Paginate through all mappings (PostgREST defaults to 1000 max per request)
    const pageSize = 1000;
    let from = 0;
    const allMappings: Array<{ uri: string; tmdb_id: number }> = [];

    while (true) {
      const queryPromise = supabase
        .from('film_tmdb_map')
        .select('uri, tmdb_id')
        .eq('user_id', userId)
        .range(from, from + pageSize - 1);

      const { data, error } = await withTimeout(
        queryPromise as unknown as Promise<{ data: Array<{ uri: string; tmdb_id: number }>; error: any }>,
        15000
      );

      if (error) {
        console.error('[Mappings] error fetching mappings page', { from, error, code: error.code, message: error.message });
        break;
      }

      const rows = data ?? [];
      allMappings.push(...rows);

      // If we got fewer than pageSize, we've fetched all rows
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    console.log('[Mappings] all mappings loaded', { totalRows: allMappings.length });

    // Filter to only the URIs we care about
    const uriSet = new Set(uris);
    for (const row of allMappings) {
      if (row.uri != null && row.tmdb_id != null && uriSet.has(row.uri)) {
        map.set(row.uri, Number(row.tmdb_id));
      }
    }

  } catch (e: any) {
    console.error('[Mappings] timeout or exception', {
      error: e,
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 3).join('\n')
    });
  }

  console.log('[Mappings] finished getFilmMappings', { totalMappings: map.size, requestedUris: uris.length });
  return map;
}


/**
 * Bulk fetch TMDB movie details from cache for a list of IDs.
 * This avoids individual API calls by fetching from Supabase tmdb_movies table.
 * @param tmdbIds - Array of TMDB IDs to fetch
 * @returns Map of TMDB ID to movie details
 */
export async function getBulkTmdbDetails(tmdbIds: number[]): Promise<Map<number, TMDBMovie>> {
  const detailsMap = new Map<number, TMDBMovie>();
  if (!supabase || tmdbIds.length === 0) return detailsMap;

  console.log('[BulkTmdb] Fetching cached details', { count: tmdbIds.length });

  try {
    // Fetch in chunks of 500 to avoid query limits
    const chunkSize = 500;
    for (let i = 0; i < tmdbIds.length; i += chunkSize) {
      const chunk = tmdbIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('tmdb_movies')
        .select('tmdb_id, data')
        .in('tmdb_id', chunk);

      if (error) {
        console.error('[BulkTmdb] Error fetching chunk', { error, chunkStart: i });
        continue;
      }

      for (const row of data ?? []) {
        if (row.tmdb_id && row.data) {
          detailsMap.set(row.tmdb_id, row.data as TMDBMovie);
        }
      }
    }

    console.log('[BulkTmdb] Fetched details', { requested: tmdbIds.length, found: detailsMap.size });
  } catch (e) {
    console.error('[BulkTmdb] Exception', e);
  }

  return detailsMap;
}

export async function blockSuggestion(userId: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('blocked_suggestions').insert({ user_id: userId, tmdb_id: tmdbId });
  if (error && error.code !== '23505') { // Ignore duplicate key errors
    console.error('[Supabase] blockSuggestion error', { userId, tmdbId, error });
    throw error;
  }
}

type FeedbackRow = {
  feedback_type: 'positive' | 'negative';
  reason_types?: string[] | null;
  movie_features?: MovieFeatures | null;
};

async function buildFeatureUpdates(features: MovieFeatures): Promise<Array<{ type: FeatureType; id: number; name: string }>> {
  const updates: Array<{ type: FeatureType; id: number; name: string }> = [];
  features.actors.slice(0, 3).forEach((actor) => updates.push({ type: 'actor', id: actor.id, name: actor.name }));
  features.keywords.slice(0, 8).forEach((keyword) => updates.push({ type: 'keyword', id: keyword.id, name: keyword.name }));
  features.directors.slice(0, 1).forEach((director) => updates.push({ type: 'director', id: director.id, name: director.name }));
  features.genres.slice(0, 3).forEach((genre) => updates.push({ type: 'genre', id: genre.id, name: genre.name }));
  if (features.collection) {
    updates.push({ type: 'collection', id: features.collection.id, name: features.collection.name });
  }
  return updates;
}

async function clearSuggestionFeedback(userId: string, tmdbId: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase
    .from('suggestion_feedback')
    .select('feedback_type, reason_types, movie_features')
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId)
    .maybeSingle();

  if (error) {
    console.error('[Supabase] clearSuggestionFeedback fetch error', { userId, tmdbId, error });
    return;
  }

  if (!data) return;

  const row = data as FeedbackRow;
  const feedbackType = row.feedback_type;
  const reasonTypes = row.reason_types ?? [];

  // Adjust reason-level preferences
  for (const reasonType of reasonTypes) {
    const { data: existing } = await supabase
      .from('user_reason_preferences')
      .select('success_count, total_count')
      .eq('user_id', userId)
      .eq('reason_type', reasonType)
      .maybeSingle();

    const successCountRaw = existing?.success_count ?? 0;
    const totalCountRaw = existing?.total_count ?? 0;
    const successCount = feedbackType === 'positive' ? Math.max(0, successCountRaw - 1) : successCountRaw;
    const totalCount = Math.max(0, totalCountRaw - 1);
    const successRate = totalCount > 0 ? successCount / totalCount : 0.5;

    await supabase
      .from('user_reason_preferences')
      .upsert({
        user_id: userId,
        reason_type: reasonType,
        success_count: successCount,
        total_count: totalCount,
        success_rate: successRate,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'user_id,reason_type'
      });
  }

  // Adjust feature-level preferences
  let features: MovieFeatures | null = row.movie_features ?? null;
  if (!features) {
    try {
      features = await extractMovieFeatures(tmdbId);
    } catch (e) {
      console.error('[Supabase] clearSuggestionFeedback extract features failed', { tmdbId, error: e });
    }
  }

  if (features) {
    const updates = await buildFeatureUpdates(features);
    for (const update of updates) {
      const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', update.type)
        .eq('feature_id', update.id)
        .maybeSingle();

      const positiveRaw = existing?.positive_count ?? 0;
      const negativeRaw = existing?.negative_count ?? 0;
      const positive = feedbackType === 'positive' ? Math.max(0, positiveRaw - 1) : positiveRaw;
      const negative = feedbackType === 'negative' ? Math.max(0, negativeRaw - 1) : negativeRaw;
      const total = positive + negative;
      const inferredPreference = total > 0 ? positive / total : 0.5;

      await supabase
        .from('user_feature_feedback')
        .upsert({
          user_id: userId,
          feature_type: update.type,
          feature_id: update.id,
          feature_name: update.name,
          positive_count: positive,
          negative_count: negative,
          inferred_preference: inferredPreference,
          last_updated: new Date().toISOString(),
        }, {
          onConflict: 'user_id,feature_type,feature_id'
        });
    }
  }

  // Remove the raw feedback row last
  const { error: deleteError } = await supabase
    .from('suggestion_feedback')
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId);

  if (deleteError) {
    console.error('[Supabase] clearSuggestionFeedback delete error', { userId, tmdbId, deleteError });
  }
}

export async function unblockSuggestion(userId: string, tmdbId: number, opts?: { skipFeedbackClear?: boolean }) {
  if (!supabase) throw new Error('Supabase not initialized');

  if (!opts?.skipFeedbackClear) {
    await clearSuggestionFeedback(userId, tmdbId);
  }

  const { error } = await supabase.from('blocked_suggestions').delete().eq('user_id', userId).eq('tmdb_id', tmdbId);
  if (error) {
    console.error('[Supabase] unblockSuggestion error', { userId, tmdbId, error });
    throw error;
  }
}

export async function removeAllowedSuggestion(userId: string, tmdbId: number): Promise<void> {
  try {
    await clearSuggestionFeedback(userId, tmdbId);
    console.log('[RemoveAllowed] Cleared positive feedback and related preferences', { userId: userId.slice(0, 8), tmdbId });
  } catch (e) {
    console.error('[RemoveAllowed] Failed to remove allowed suggestion', { tmdbId, error: e });
    throw e;
  }
}

export async function neutralizeFeedback(userId: string, tmdbId: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not initialized');

  try {
    await clearSuggestionFeedback(userId, tmdbId);
    await unblockSuggestion(userId, tmdbId, { skipFeedbackClear: true }).catch((e) => console.warn('[Neutralize] unblock failed', e));
    console.log('[Neutralize] Cleared feedback and unblocked', { userId: userId.slice(0, 8), tmdbId });
  } catch (e) {
    console.error('[Neutralize] Failed to neutralize feedback', { tmdbId, error: e });
  }
}

export async function getBlockedSuggestions(userId: string): Promise<Set<number>> {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase
    .from('blocked_suggestions')
    .select('tmdb_id')
    .eq('user_id', userId);

  if (error) {
    console.error('[Supabase] getBlockedSuggestions error', { userId, error });
    return new Set();
  }

  return new Set((data ?? []).map(row => Number(row.tmdb_id)));
}

export async function getAllowedSuggestions(userId: string): Promise<Set<number>> {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase
    .from('suggestion_feedback')
    .select('tmdb_id')
    .eq('user_id', userId)
    .eq('feedback_type', 'positive');

  if (error) {
    console.error('[Supabase] getAllowedSuggestions error', { userId, error });
    return new Set();
  }

  return new Set((data ?? []).map(row => Number(row.tmdb_id)));
}

/**
 * Extract reason types from a list of reason strings
 * Maps reason text patterns to reason type categories
 */
function extractReasonTypes(reasons: string[]): string[] {
  const types = new Set<string>();

  for (const reason of reasons) {
    const lower = reason.toLowerCase();

    // Director matches
    if (lower.includes('directed by') || lower.includes('director')) {
      types.add('director');
    }

    // Genre matches
    if (lower.includes('matches your taste in') || lower.includes('genre')) {
      types.add('genre');
    }

    // Actor/cast matches
    if (lower.includes('stars ') || lower.includes('starring') || lower.includes('cast member') || lower.includes('actor')) {
      types.add('actor');
    }

    // Keyword/theme matches
    if (lower.includes('theme') || lower.includes('keyword')) {
      types.add('keyword');
    }

    // Studio matches
    if (lower.includes('from ') && (lower.includes('studio') || lower.includes('a24') || lower.includes('neon') || lower.includes('ghibli'))) {
      types.add('studio');
    }

    // Collection matches
    if (lower.includes('collection') || lower.includes('franchise') || lower.includes('sequel') || lower.includes('prequel')) {
      types.add('collection');
    }

    // Decade matches
    if (lower.includes('decade') || lower.includes("'s films") || /\d{4}s/.test(reason)) {
      types.add('decade');
    }

    // Recent watch matches
    if (lower.includes('recent') && (lower.includes('watch') || lower.includes('favorite'))) {
      types.add('recent');
    }
  }

  return Array.from(types);
}

/**
 * Learning insights returned from addFeedback
 * Used to show Pandora-style "learning" messages to user
 */
export interface FeedbackLearningInsights {
  /** Features that had their penalty increased (for negative feedback) */
  strengthenedAvoidance: string[];
  /** Features that are now being penalized for the first time */
  newAvoidance: string[];
  /** Features that had their preference increased (for positive feedback) */
  strengthenedPreference: string[];
  /** Primary feature that likely triggered this feedback */
  likelyReason?: string;
  /** Message summarizing what was learned */
  learningSummary: string;
}

export type FeatureType = 'actor' | 'keyword' | 'genre' | 'collection' | 'director';

export type FeatureEvidenceSummary = {
  positiveCount: number;
  negativeCount: number;
  totalCount: number;
  lastUpdated: string | null;
  decayMultiplier: number;
};

export async function addFeedback(
  userId: string,
  tmdbId: number,
  type: 'negative' | 'positive',
  reasons?: string[],
  opts?: { sources?: string[]; consensusLevel?: 'high' | 'medium' | 'low' }
): Promise<FeedbackLearningInsights> {
  if (!supabase) throw new Error('Supabase not initialized');

  // Extract reason types from the suggestion reasons
  const reasonTypes = reasons ? extractReasonTypes(reasons) : [];

  // Fetch the movie's features for learning
  let movieFeatures: MovieFeatures | null = null;
  try {
    movieFeatures = await extractMovieFeatures(tmdbId);
  } catch (e) {
    console.error('[FeatureFeedback] Failed to extract movie features', { tmdbId, error: e });
  }

  // Get existing feature preferences to detect what's being strengthened vs new
  const existingFeatures = await getExistingFeaturePreferences(userId, movieFeatures);

  // Upsert feedback (replaces any existing feedback for this user+movie pair)
  // This prevents duplicates when user undos and re-dismisses
  const { error } = await supabase.from('suggestion_feedback').upsert({
    user_id: userId,
    tmdb_id: tmdbId,
    feedback_type: type,
    reason_types: reasonTypes,
    movie_features: movieFeatures || {},
    recommendation_sources: opts?.sources ?? [],
    consensus_level: opts?.consensusLevel ?? null
  }, { onConflict: 'user_id,tmdb_id' });

  if (error) {
    console.error('[Supabase] addFeedback error', { userId, tmdbId, type, error });
    throw error;
  }

  // Update reason type preferences based on feedback
  if (reasonTypes.length > 0) {
    await updateReasonPreferences(userId, reasonTypes, type === 'positive');
  }

  // Update feature-level preferences (learn specific actors, keywords, etc.)
  if (movieFeatures) {
    await updateFeaturePreferences(userId, movieFeatures, type === 'positive');
  }

  // Detect patterns in recent feedback (e.g., rejecting multiple superhero movies)
  let patternInsights: string[] = [];
  if (type === 'negative') {
    patternInsights = await detectFeedbackPatterns(userId);
  }

  // Build learning insights for UI feedback (Pandora-style)
  const insights = buildLearningInsights(
    movieFeatures,
    existingFeatures,
    type === 'positive',
    patternInsights
  );

  console.log(`[FeedbackLearning] Processed ${type} feedback for movie ${tmdbId}`, {
    reasonTypes,
    features: movieFeatures ? {
      actors: movieFeatures.actors?.slice(0, 3).map(a => a.name),
      keywords: movieFeatures.keywords?.slice(0, 5).map(k => k.name),
      collection: movieFeatures.collection?.name,
      genres: movieFeatures.genres?.map(g => g.name)
    } : 'none',
    insights
  });

  return insights;
}

type PairwiseConsensus = 'high' | 'medium' | 'low' | undefined;

type SuggestContextMode = 'auto' | 'weeknight' | 'short' | 'immersive' | 'family' | 'background';
type SuggestContext = { mode: SuggestContextMode; localHour?: number | null };

export async function recordPairwiseEvent(
  userId: string,
  payload: {
    winnerId: number;
    loserId: number;
    sharedReasonTags?: string[];
    winnerSources?: string[];
    loserSources?: string[];
    winnerConsensus?: PairwiseConsensus;
    loserConsensus?: PairwiseConsensus;
  }
): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase.from('pairwise_events').insert({
      user_id: userId,
      winner_tmdb_id: payload.winnerId,
      loser_tmdb_id: payload.loserId,
      shared_reason_tags: payload.sharedReasonTags ?? [],
      winner_sources: payload.winnerSources ?? [],
      loser_sources: payload.loserSources ?? [],
      winner_consensus: payload.winnerConsensus ?? null,
      loser_consensus: payload.loserConsensus ?? null,
    });

    if (error) {
      console.error('[PairwiseEvent] Failed to insert', error);
    }
  } catch (e) {
    console.error('[PairwiseEvent] Exception inserting event', e);
  }
}

function deriveContextMode(context?: SuggestContext): { mode: Exclude<SuggestContextMode, 'auto'>; hour: number | null } {
  const hour = context?.localHour ?? new Date().getHours();
  const fallback = { mode: 'background' as const, hour };

  if (!context) return fallback;
  if (context.mode && context.mode !== 'auto') return { mode: context.mode, hour };

  if (hour >= 22 || hour <= 6) return { mode: 'short', hour };
  if (hour >= 17 && hour <= 21) return { mode: 'weeknight', hour };
  if (hour >= 7 && hour <= 9) return { mode: 'short', hour };

  return fallback;
}

type FeatureDelta = {
  feature_type: 'actor' | 'keyword' | 'collection' | 'director' | 'genre' | 'subgenre';
  feature_id: number;
  feature_name: string;
  deltaPositive: number;
  deltaNegative: number;
};

function selectPairwiseFeatureSlice(features: MovieFeatures): FeatureDelta[] {
  const rows: FeatureDelta[] = [];
  features.actors.slice(0, 3).forEach((actor) =>
    rows.push({ feature_type: 'actor', feature_id: actor.id, feature_name: actor.name, deltaPositive: 0, deltaNegative: 0 })
  );
  features.keywords.slice(0, 8).forEach((keyword) =>
    rows.push({ feature_type: 'keyword', feature_id: keyword.id, feature_name: keyword.name, deltaPositive: 0, deltaNegative: 0 })
  );
  if (features.collection) {
    rows.push({ feature_type: 'collection', feature_id: features.collection.id, feature_name: features.collection.name, deltaPositive: 0, deltaNegative: 0 });
  }
  features.directors.slice(0, 1).forEach((director) =>
    rows.push({ feature_type: 'director', feature_id: director.id, feature_name: director.name, deltaPositive: 0, deltaNegative: 0 })
  );
  features.genres.slice(0, 3).forEach((genre) =>
    rows.push({ feature_type: 'genre', feature_id: genre.id, feature_name: genre.name, deltaPositive: 0, deltaNegative: 0 })
  );
  if (features.subgenres && features.subgenres.length > 0) {
    features.subgenres.slice(0, 5).forEach((subgenre) =>
      rows.push({ feature_type: 'subgenre', feature_id: subgenre.id, feature_name: subgenre.key, deltaPositive: 0, deltaNegative: 0 })
    );
  }
  return rows;
}

async function applyFeatureDelta(
  userId: string,
  update: FeatureDelta
): Promise<void> {
  if (!supabase) return;

  try {
    const { data: existing } = await supabase
      .from('user_feature_feedback')
      .select('positive_count, negative_count, feature_name')
      .eq('user_id', userId)
      .eq('feature_type', update.feature_type)
      .eq('feature_id', update.feature_id)
      .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + update.deltaPositive;
    const negativeCount = (existing?.negative_count || 0) + update.deltaNegative;
    const total = positiveCount + negativeCount;
    // Bayesian win rate with neutral prior (Laplace smoothing) to regularize pairwise-driven updates
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
      .from('user_feature_feedback')
      .upsert(
        {
          user_id: userId,
          feature_type: update.feature_type,
          feature_id: update.feature_id,
          feature_name: update.feature_name || existing?.feature_name || '',
          positive_count: positiveCount,
          negative_count: negativeCount,
          inferred_preference: inferredPreference,
          last_updated: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,feature_type,feature_id',
        }
      );
  } catch (e) {
    console.error('[PairwiseLearning] Failed to apply feature delta', { update, error: e });
  }
}

export async function applyPairwiseFeatureLearning(userId: string, winnerTmdbId: number, loserTmdbId: number): Promise<void> {
  if (!supabase) return;

  try {
    const [winnerFeatures, loserFeatures] = await Promise.all([
      extractMovieFeatures(winnerTmdbId),
      extractMovieFeatures(loserTmdbId),
    ]);

    const winnerSlice = selectPairwiseFeatureSlice(winnerFeatures);
    const loserSlice = selectPairwiseFeatureSlice(loserFeatures);

    const winnerKeys = new Set(winnerSlice.map((f) => `${f.feature_type}:${f.feature_id}`));
    const loserKeys = new Set(loserSlice.map((f) => `${f.feature_type}:${f.feature_id}`));

    const updates = new Map<string, FeatureDelta>();

    // Features that only the winner has get a small positive nudge
    for (const feat of winnerSlice) {
      const key = `${feat.feature_type}:${feat.feature_id}`;
      if (loserKeys.has(key)) continue;
      updates.set(key, { ...feat, deltaPositive: 1, deltaNegative: 0 });
    }

    // Features that only the loser has get a small negative nudge
    for (const feat of loserSlice) {
      const key = `${feat.feature_type}:${feat.feature_id}`;
      if (winnerKeys.has(key)) continue;
      if (updates.has(key)) continue;
      updates.set(key, { ...feat, deltaPositive: 0, deltaNegative: 1 });
    }

    for (const update of updates.values()) {
      await applyFeatureDelta(userId, update);
    }

    if (updates.size > 0) {
      console.log('[PairwiseLearning] Applied feature deltas', { userId: userId.slice(0, 8), updates: updates.size });
    }
  } catch (e) {
    console.error('[PairwiseLearning] Failed to apply pairwise learning', e);
  }
}

/**
 * Derive per-source reliability multipliers from suggestion_feedback (Laplace-smoothed hit rate mapped to ~0.9–1.12)
 */
const sourceReliabilityCache = new Map<string, { at: number; data: Map<string, number> }>();
const SOURCE_RELIABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchSourceReliability(userId: string): Promise<Map<string, number>> {
  const reliability = new Map<string, number>();
  if (!supabase) return reliability;

  const cached = sourceReliabilityCache.get(userId);
  if (cached && Date.now() - cached.at < SOURCE_RELIABILITY_TTL_MS) {
    return cached.data;
  }

  try {
    const { data, error } = await supabase
      .from('suggestion_feedback')
      .select('feedback_type, recommendation_sources, consensus_level')
      .eq('user_id', userId);

    if (error) {
      console.error('[SourceReliability] Error fetching feedback', error);
      return reliability;
    }

    const stats = new Map<string, { pos: number; total: number }>();
    data?.forEach((row: any) => {
      const sources: string[] = Array.isArray(row.recommendation_sources) ? row.recommendation_sources : [];
      const isPos = row.feedback_type === 'positive';
      const level = (row.consensus_level as 'high' | 'medium' | 'low' | null) ?? 'low';
      const weight = level === 'high' ? 1.0 : level === 'medium' ? 0.7 : 0.4; // down-weight low-consensus signals
      sources.forEach((s) => {
        const key = (s || '').toLowerCase();
        if (!key) return;
        const curr = stats.get(key) ?? { pos: 0, total: 0 };
        if (isPos) curr.pos += weight;
        curr.total += weight;
        stats.set(key, curr);
      });
    });

    for (const [src, { pos, total }] of stats.entries()) {
      const rate = (pos + 1) / (total + 2); // Laplace smoothing with weighted totals
      const multiplier = Math.min(1.12, Math.max(0.9, 1 + (rate - 0.5) * 0.4));
      reliability.set(src, multiplier);
    }

    sourceReliabilityCache.set(userId, { at: Date.now(), data: reliability });
    return reliability;
  } catch (e) {
    console.error('[SourceReliability] Exception', e);
    return reliability;
  }
}

/**
 * Get existing feature preferences to determine what's new vs strengthened
 */
async function getExistingFeaturePreferences(
  userId: string,
  features: MovieFeatures | null
): Promise<Map<string, { positive: number; negative: number }>> {
  if (!supabase || !features) return new Map();

  const featureIds: number[] = [
    ...features.actors.map(a => a.id),
    ...features.keywords.map(k => k.id),
    ...(features.collection ? [features.collection.id] : [])
  ];

  if (featureIds.length === 0) return new Map();

  const { data } = await supabase
    .from('user_feature_feedback')
    .select('feature_type, feature_id, positive_count, negative_count')
    .eq('user_id', userId)
    .in('feature_id', featureIds);

  const map = new Map<string, { positive: number; negative: number }>();
  for (const row of data || []) {
    map.set(`${row.feature_type}:${row.feature_id}`, {
      positive: row.positive_count,
      negative: row.negative_count
    });
  }
  return map;
}

/**
 * Build learning insights for Pandora-style feedback messages
 */
function buildLearningInsights(
  features: MovieFeatures | null,
  existingPrefs: Map<string, { positive: number; negative: number }>,
  isPositive: boolean,
  patternInsights: string[]
): FeedbackLearningInsights {
  const strengthenedAvoidance: string[] = [];
  const newAvoidance: string[] = [];
  const strengthenedPreference: string[] = [];

  if (features) {
    // Check actors (top 3 as they're the strongest signals)
    for (const actor of features.actors.slice(0, 3)) {
      const key = `actor:${actor.id}`;
      const existing = existingPrefs.get(key);

      if (!isPositive) {
        if (existing && existing.negative > 0) {
          strengthenedAvoidance.push(actor.name);
        } else {
          newAvoidance.push(actor.name);
        }
      } else {
        if (existing && existing.positive > 0) {
          strengthenedPreference.push(actor.name);
        }
      }
    }

    // Check collection/franchise
    if (features.collection) {
      const key = `collection:${features.collection.id}`;
      const existing = existingPrefs.get(key);

      if (!isPositive) {
        if (existing && existing.negative > 0) {
          strengthenedAvoidance.push(features.collection.name);
        } else {
          newAvoidance.push(features.collection.name);
        }
      }
    }

    // Check keywords (top 3)
    for (const keyword of features.keywords.slice(0, 3)) {
      const key = `keyword:${keyword.id}`;
      const existing = existingPrefs.get(key);

      if (!isPositive) {
        if (existing && existing.negative > 0) {
          strengthenedAvoidance.push(keyword.name);
        }
        // Don't add new keywords to avoid message - too noisy
      }
    }
  }

  // Build the learning summary message
  let learningSummary: string;
  let likelyReason: string | undefined;

  if (isPositive) {
    if (strengthenedPreference.length > 0) {
      likelyReason = strengthenedPreference[0];
      learningSummary = `👍 Learning you love ${strengthenedPreference.slice(0, 2).join(' and ')}. We'll show more!`;
    } else {
      learningSummary = "👍 Thanks! We'll find more movies like this.";
    }
  } else {
    // Negative feedback - prioritize patterns and strengthened avoidance
    if (patternInsights.length > 0) {
      learningSummary = patternInsights[0]; // Pattern detection messages are already formatted
      likelyReason = strengthenedAvoidance[0] || newAvoidance[0];
    } else if (strengthenedAvoidance.length > 0) {
      likelyReason = strengthenedAvoidance[0];
      const count = 2; // We know they've rejected at least 2 now
      learningSummary = `👎 Got it. ${strengthenedAvoidance[0]} movies are now less likely to appear.`;
    } else if (features?.collection) {
      likelyReason = features.collection.name;
      learningSummary = `👎 Noted. We'll show fewer ${features.collection.name} movies.`;
    } else if (newAvoidance.length > 0) {
      likelyReason = newAvoidance[0];
      learningSummary = `👎 Got it. We'll remember you passed on this.`;
    } else {
      learningSummary = "👎 Got it, we won't show this movie again.";
    }
  }

  return {
    strengthenedAvoidance,
    newAvoidance,
    strengthenedPreference,
    likelyReason,
    learningSummary
  };
}

/**
 * Movie features extracted for learning
 */
interface MovieFeatures {
  actors: Array<{ id: number; name: string; order: number }>;
  keywords: Array<{ id: number; name: string }>;
  directors: Array<{ id: number; name: string }>;
  genres: Array<{ id: number; name: string }>;
  collection?: { id: number; name: string };
  studios: Array<{ id: number; name: string }>;
  subgenres: Array<{ id: number; key: string; parentGenre: string }>;
}

/**
 * Get movie features for the feedback popup (public export)
 * Returns simplified data for quick-tap reason selection
 */
export async function getMovieFeaturesForPopup(tmdbId: number): Promise<{
  leadActors: string[];
  franchise?: string;
  topKeywords: string[];
  genres: string[];
  director?: string;
}> {
  try {
    const features = await extractMovieFeatures(tmdbId);
    return {
      leadActors: features.actors.slice(0, 3).map(a => a.name),
      franchise: features.collection?.name,
      topKeywords: features.keywords.slice(0, 5).map(k => k.name),
      genres: features.genres.map(g => g.name),
      director: features.directors[0]?.name
    };
  } catch (e) {
    console.error('[FeedbackPopup] Failed to get movie features', e);
    return { leadActors: [], topKeywords: [], genres: [] };
  }
}

/**
 * Fetch evidence (sample counts + recency) for specific feature names.
 * Used by UI to show strength/recency badges next to reasons and feedback chips.
 */
export async function getFeatureEvidenceSummary(
  userId: string,
  featureRequests: Array<{ type: FeatureType; name: string }>
): Promise<Map<string, FeatureEvidenceSummary>> {
  const evidence = new Map<string, FeatureEvidenceSummary>();
  if (!supabase || featureRequests.length === 0) return evidence;

  const grouped = new Map<FeatureType, string[]>();
  for (const req of featureRequests) {
    const trimmed = (req.name || '').trim();
    if (!trimmed) continue;
    grouped.set(req.type, [...(grouped.get(req.type) ?? []), trimmed]);
  }

  const computeDecayMultiplier = (lastUpdated?: string | null) => {
    if (!lastUpdated) return 1;
    const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 1.3;
    if (daysSince < 30) return 1;
    return 0.8;
  };

  for (const [type, names] of grouped.entries()) {
    const unique = Array.from(new Set(names));
    if (unique.length === 0) continue;

    try {
      const { data, error } = await supabase
        .from('user_feature_feedback')
        .select('feature_name, positive_count, negative_count, last_updated')
        .eq('user_id', userId)
        .eq('feature_type', type)
        .in('feature_name', unique);

      if (error) {
        console.error('[FeatureEvidence] Failed to fetch evidence', { type, error });
        continue;
      }

      data?.forEach((row: any) => {
        const positive = row?.positive_count ?? 0;
        const negative = row?.negative_count ?? 0;
        const totalCount = positive + negative;
        const lastUpdated = row?.last_updated ?? null;
        const key = `${type}:${(row?.feature_name || '').toLowerCase()}`;
        evidence.set(key, {
          positiveCount: positive,
          negativeCount: negative,
          totalCount,
          lastUpdated,
          decayMultiplier: computeDecayMultiplier(lastUpdated)
        });
      });
    } catch (e) {
      console.error('[FeatureEvidence] Exception while fetching evidence', { type, error: e });
    }
  }

  return evidence;
}

/**
 * Boost a specific feature based on explicit user selection
 * This adds EXTRA weight when user explicitly clicks a reason (vs automatic pattern detection)
 * @param explicitBoost - How many extra negative counts to add (default 2 = 3x the signal of automatic)
 */
export async function boostExplicitFeedback(
  userId: string,
  featureType: 'actor' | 'keyword' | 'genre' | 'collection',
  featureName: string,
  isPositive: boolean,
  explicitBoost: number = 2
): Promise<void> {
  if (!supabase) return;

  console.log('[ExplicitFeedback] Boosting', featureType, featureName, isPositive ? '+' : '-', 'by', explicitBoost);

  try {
    // Get or create the feature record
    // Look up by feature_name (primary identifier for user-selected feedback)
    const { data: existing } = await supabase
      .from('user_feature_feedback')
      .select('feature_id, positive_count, negative_count')
      .eq('user_id', userId)
      .eq('feature_type', featureType)
      .eq('feature_name', featureName)
      .maybeSingle();

    // Use existing feature_id if available, otherwise 0 (will be updated later when ID is known)
    const featureId = existing?.feature_id || 0;
    const currentPositive = existing?.positive_count || 0;
    const currentNegative = existing?.negative_count || 0;

    // Add explicit boost
    const newPositive = currentPositive + (isPositive ? explicitBoost : 0);
    const newNegative = currentNegative + (isPositive ? 0 : explicitBoost);
    const total = newPositive + newNegative;
    const inferredPreference = total > 0 ? newPositive / total : 0.5;

    // Upsert using feature_name as the conflict key (matches new unique constraint)
    await supabase
      .from('user_feature_feedback')
      .upsert({
        user_id: userId,
        feature_type: featureType,
        feature_id: featureId,
        feature_name: featureName,
        positive_count: newPositive,
        negative_count: newNegative,
        inferred_preference: inferredPreference,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'user_id,feature_type,feature_name'
      });

    console.log('[ExplicitFeedback] Updated', featureName, ':', { newPositive, newNegative, inferredPreference });
  } catch (e) {
    console.error('[ExplicitFeedback] Failed to boost', featureName, e);
  }
}

/**
 * Extract key features from a movie for learning
 */
async function extractMovieFeatures(tmdbId: number): Promise<MovieFeatures> {
  const movie = await fetchTmdbMovieCached(tmdbId);
  if (!movie) {
    return { actors: [], keywords: [], directors: [], genres: [], studios: [], subgenres: [] };
  }

  const features = extractFeatures(movie);

  // Detect subgenres from genres + keywords using existing function
  const allText = (movie.title || '').toLowerCase() + ' ' + (movie.overview || '').toLowerCase();
  const detectedSubgenres: Array<{ id: number; key: string; parentGenre: string }> = [];

  for (const genre of features.genres) {
    const subs = detectSubgenres(genre, allText, features.keywords, features.keywordIds);
    for (const sub of subs) {
      // Avoid duplicates
      if (!detectedSubgenres.some(s => s.key === sub)) {
        detectedSubgenres.push({
          id: stringHash(sub),
          key: sub,
          parentGenre: genre
        });
      }
    }
  }

  return {
    actors: (movie.credits?.cast || []).slice(0, 5).map((a: any, idx: number) => ({
      id: a.id,
      name: a.name,
      order: idx
    })),
    keywords: features.keywordIds.map((id, idx) => ({
      id,
      name: features.keywords[idx]
    })),
    directors: features.directorIds.map((id, idx) => ({
      id,
      name: features.directors[idx]
    })),
    genres: features.genreIds.map((id, idx) => ({
      id,
      name: features.genres[idx]
    })),
    collection: features.collection ? {
      id: features.collection.id,
      name: features.collection.name
    } : undefined,
    studios: features.productionCompanyIds.map((id, idx) => ({
      id,
      name: features.productionCompanies[idx]
    })),
    subgenres: detectedSubgenres
  };
}

/**
 * Update feature-level preferences based on feedback
 * This learns WHICH SPECIFIC actors, keywords, etc. the user likes/dislikes
 */
async function updateFeaturePreferences(
  userId: string,
  features: MovieFeatures,
  isPositive: boolean
) {
  if (!supabase) return;

  const updates: Array<{
    feature_type: string;
    feature_id: number;
    feature_name: string;
  }> = [];

  // Track lead actors (top 3 billed) - these are strong signals
  features.actors.slice(0, 3).forEach(actor => {
    updates.push({
      feature_type: 'actor',
      feature_id: actor.id,
      feature_name: actor.name
    });
  });

  // Track keywords/themes (top 10) - these indicate content type
  features.keywords.slice(0, 10).forEach(keyword => {
    updates.push({
      feature_type: 'keyword',
      feature_id: keyword.id,
      feature_name: keyword.name
    });
  });

  // Track top directors (strong stylistic signal)
  features.directors.slice(0, 2).forEach(director => {
    updates.push({
      feature_type: 'director',
      feature_id: director.id,
      feature_name: director.name
    });
  });

  // Track genres (capture tone/content preferences)
  features.genres.slice(0, 5).forEach(genre => {
    updates.push({
      feature_type: 'genre',
      feature_id: genre.id,
      feature_name: genre.name
    });
  });

  // Track collection/franchise - strong signal for franchise fatigue
  if (features.collection) {
    updates.push({
      feature_type: 'collection',
      feature_id: features.collection.id,
      feature_name: features.collection.name
    });
  }

  // Track subgenres - nuanced taste signals (e.g., HORROR_FOLK, THRILLER_PSYCHOLOGICAL)
  if (features.subgenres && features.subgenres.length > 0) {
    features.subgenres.slice(0, 5).forEach(subgenre => {
      updates.push({
        feature_type: 'subgenre',
        feature_id: subgenre.id,
        feature_name: subgenre.key // e.g., 'HORROR_FOLK'
      });
    });
    console.log('[SubgenreFeedback] Detected subgenres for feedback learning:', features.subgenres.map(s => s.key));
  }

  // Update each feature's feedback counts
  for (const update of updates) {
    try {
      // First, try to get existing record
      const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', update.feature_type)
        .eq('feature_id', update.feature_id)
        .maybeSingle();

      const positiveCount = (existing?.positive_count || 0) + (isPositive ? 1 : 0);
      const negativeCount = (existing?.negative_count || 0) + (isPositive ? 0 : 1);
      const total = positiveCount + negativeCount;
      // Bayesian win rate with a neutral prior (Laplace smoothing) to avoid overreacting to low counts
      const winRate = (positiveCount + 1) / (total + 2); // 0.5 at zero data, trends to observed rate
      const inferredPreference = winRate;

      await supabase
        .from('user_feature_feedback')
        .upsert({
          user_id: userId,
          feature_type: update.feature_type,
          feature_id: update.feature_id,
          feature_name: update.feature_name,
          positive_count: positiveCount,
          negative_count: negativeCount,
          inferred_preference: inferredPreference,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'user_id,feature_type,feature_id'
        });
    } catch (e) {
      console.error('[FeaturePreference] Error updating', { update, error: e });
    }
  }

  console.log('[FeaturePreference] Updated feature preferences', {
    userId: userId.slice(0, 8),
    isPositive,
    featuresUpdated: updates.length
  });
}

/**
 * Detect patterns in recent negative feedback
 * If user rejects multiple movies with same actor/franchise/keyword, learn to avoid
 */
async function detectFeedbackPatterns(userId: string): Promise<string[]> {
  if (!supabase) return [];

  const insights: string[] = [];

  try {
    // Get features that have been negatively rated multiple times
    const { data: avoidedFeatures } = await supabase
      .from('user_feature_feedback')
      .select('feature_type, feature_id, feature_name, negative_count, positive_count, inferred_preference')
      .eq('user_id', userId)
      .gte('negative_count', 2) // At least 2 negative interactions
      .lte('inferred_preference', 0.35) // More negatives than positives
      .order('negative_count', { ascending: false })
      .limit(20);

    if (!avoidedFeatures || avoidedFeatures.length === 0) return [];

    // Log detected patterns
    const patterns = avoidedFeatures.map(f => ({
      type: f.feature_type,
      name: f.feature_name,
      negatives: f.negative_count,
      positives: f.positive_count,
      preference: f.inferred_preference
    }));

    console.log('[PatternDetection] Detected avoidance patterns:', patterns.slice(0, 5));

    // Actors with 3+ rejections and low preference are strongly avoided
    const avoidedActors = avoidedFeatures.filter(
      f => f.feature_type === 'actor' && f.negative_count >= 3 && f.inferred_preference <= 0.3
    );

    // Franchises with 2+ rejections - user likely has franchise fatigue
    const avoidedFranchises = avoidedFeatures.filter(
      f => f.feature_type === 'collection' && f.negative_count >= 2
    );

    // Keywords with 3+ rejections - indicates content aversion
    const avoidedKeywords = avoidedFeatures.filter(
      f => f.feature_type === 'keyword' && f.negative_count >= 3 && f.inferred_preference <= 0.25
    );

    if (avoidedActors.length > 0) {
      const actorName = avoidedActors[0].feature_name;
      const count = avoidedActors[0].negative_count;
      insights.push(`👎 Pattern detected: You've passed on ${count} movies with ${actorName}. They'll appear less often now.`);
      console.log('[PatternDetection] Strong actor avoidance detected:',
        avoidedActors.map(a => `${a.feature_name}(${a.negative_count}👎/${a.positive_count}👍)`));
    }

    if (avoidedFranchises.length > 0) {
      const franchiseName = avoidedFranchises[0].feature_name;
      insights.push(`👎 Franchise fatigue detected: Reducing ${franchiseName} suggestions.`);
      console.log('[PatternDetection] Franchise fatigue detected:',
        avoidedFranchises.map(f => f.feature_name));
    }

    if (avoidedKeywords.length > 0) {
      const keywordName = avoidedKeywords[0].feature_name;
      const count = avoidedKeywords[0].negative_count;
      insights.push(`👎 Learning from ${count} rejections: Less "${keywordName}" themed content.`);
      console.log('[PatternDetection] Content avoidance detected:',
        avoidedKeywords.map(k => `${k.feature_name}(${k.negative_count}👎)`));
    }

  } catch (e) {
    console.error('[PatternDetection] Error detecting patterns', e);
  }

  return insights;
}

/**
 * Get user's avoided features for filtering/scoring
 * PANDORA-STYLE: Graduated penalties that apply IMMEDIATELY
 * - 1 rejection = small penalty (learning starts right away)
 * - 2 rejections = medium penalty  
 * - 3+ rejections = strong penalty
 * This mirrors how Pandora learns from thumbs down immediately
 */
export async function getAvoidedFeatures(userId: string): Promise<{
  avoidActors: Array<{ id: number; name: string; weight: number; count: number }>;
  avoidKeywords: Array<{ id: number; name: string; weight: number; count: number }>;
  avoidFranchises: Array<{ id: number; name: string; weight: number; count: number }>;
  avoidDirectors: Array<{ id: number; name: string; weight: number; count: number }>;
  avoidGenres: Array<{ id: number; name: string; weight: number; count: number }>;
  avoidSubgenres: Array<{ key: string; weight: number; count: number }>;
  preferActors: Array<{ id: number; name: string; weight: number; count: number }>;
  preferKeywords: Array<{ id: number; name: string; weight: number; count: number }>;
  preferDirectors: Array<{ id: number; name: string; weight: number; count: number }>;
  preferGenres: Array<{ id: number; name: string; weight: number; count: number }>;
  preferSubgenres: Array<{ key: string; weight: number; count: number }>;
}> {
  if (!supabase) {
    return { avoidActors: [], avoidKeywords: [], avoidFranchises: [], avoidDirectors: [], avoidGenres: [], avoidSubgenres: [], preferActors: [], preferKeywords: [], preferDirectors: [], preferGenres: [], preferSubgenres: [] };
  }

  try {
    // Get ALL features with ANY feedback (Pandora learns from first interaction)
    const { data } = await supabase
      .from('user_feature_feedback')
      .select('feature_type, feature_id, feature_name, negative_count, positive_count, inferred_preference, last_updated')
      .eq('user_id', userId)
      .or('negative_count.gte.1,positive_count.gte.1'); // Start learning from FIRST interaction

    if (!data) {
      return { avoidActors: [], avoidKeywords: [], avoidFranchises: [], avoidDirectors: [], avoidGenres: [], avoidSubgenres: [], preferActors: [], preferKeywords: [], preferDirectors: [], preferGenres: [], preferSubgenres: [] };
    }

    // PANDORA-STYLE graduated penalty calculation
    // Penalty grows with each rejection, but even 1 rejection has an effect
    const calcGraduatedPenalty = (neg: number, pos: number): number => {
      // Net negative score (negatives minus positives)
      const netNegative = neg - pos;
      if (netNegative <= 0) return 0; // More positives than negatives = no penalty

      // Graduated penalty based on rejection count
      // 1 rejection: 0.5 weight
      // 2 rejections: 1.2 weight
      // 3 rejections: 2.0 weight
      // 4+ rejections: 2.5+ weight (capped at 3.0)
      if (netNegative === 1) return 0.5;
      if (netNegative === 2) return 1.2;
      if (netNegative === 3) return 2.0;
      return Math.min(2.5 + (netNegative - 4) * 0.25, 3.0);
    };

    // PANDORA-STYLE graduated boost calculation
    const calcGraduatedBoost = (neg: number, pos: number): number => {
      const netPositive = pos - neg;
      if (netPositive <= 0) return 0;

      // Graduated boost
      // 1 thumbs up: 0.4 weight
      // 2 thumbs up: 0.8 weight
      // 3+ thumbs up: 1.2+ weight (capped at 2.0)
      if (netPositive === 1) return 0.4;
      if (netPositive === 2) return 0.8;
      return Math.min(1.2 + (netPositive - 3) * 0.2, 2.0);
    };

    // Apply recency decay - recent feedback matters more (like Pandora)
    // Uses exponential decay with configurable half-life for smooth degradation
    const HALF_LIFE_DAYS = 90; // Signal loses half its weight every 90 days
    const DECAY_FACTOR = Math.LN2 / HALF_LIFE_DAYS;

    const applyRecencyDecay = (weight: number, lastUpdated: string): number => {
      const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);

      // Fresh signals (<7 days) get a small boost to prioritize recent learning
      if (daysSince < 7) return weight * 1.15;

      // Apply exponential decay: weight * e^(-λt) where λ = ln(2)/half-life
      // At 90 days: 50% weight, at 180 days: 25% weight, at 270 days: 12.5%
      const decayMultiplier = Math.exp(-DECAY_FACTOR * daysSince);

      // Floor at 20% to prevent total signal loss (user may still dislike that feature)
      return weight * Math.max(0.2, decayMultiplier);
    };

    // ACTORS: Start avoiding after just 1 net rejection
    const avoidActors = data
      .filter(f => f.feature_type === 'actor' && (f.negative_count - f.positive_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedPenalty(f.negative_count, f.positive_count), f.last_updated),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);

    // KEYWORDS: Start avoiding after 1 net rejection
    const avoidKeywords = data
      .filter(f => f.feature_type === 'keyword' && (f.negative_count - f.positive_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedPenalty(f.negative_count, f.positive_count), f.last_updated),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20);

    // FRANCHISES: Immediate strong penalty (1 rejection = franchise fatigue likely)
    const avoidFranchises = data
      .filter(f => f.feature_type === 'collection' && f.negative_count >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        // Franchises get stronger penalty faster (user rejected a movie FROM that franchise)
        weight: f.negative_count === 1 ? 1.5 : Math.min(2.5 + f.negative_count * 0.5, 4.0),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    // PREFERRED ACTORS: Boost starts from 1 positive
    const preferActors = data
      .filter(f => f.feature_type === 'actor' && (f.positive_count - f.negative_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedBoost(f.negative_count, f.positive_count), f.last_updated),
        count: f.positive_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);

    // PREFERRED KEYWORDS: Boost starts from 1 positive
    const preferKeywords = data
      .filter(f => f.feature_type === 'keyword' && (f.positive_count - f.negative_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedBoost(f.negative_count, f.positive_count), f.last_updated),
        count: f.positive_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20);

    // DIRECTORS: Start avoiding/preferring after 1 net rejection/approval (from pairwise learning)
    const avoidDirectors = data
      .filter(f => f.feature_type === 'director' && (f.negative_count - f.positive_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedPenalty(f.negative_count, f.positive_count), f.last_updated),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    const preferDirectors = data
      .filter(f => f.feature_type === 'director' && (f.positive_count - f.negative_count) >= 1)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedBoost(f.negative_count, f.positive_count), f.last_updated),
        count: f.positive_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    // GENRES: Start avoiding/preferring after 2 net rejections/approvals (higher threshold for broad categories)
    const avoidGenres = data
      .filter(f => f.feature_type === 'genre' && (f.negative_count - f.positive_count) >= 2)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedPenalty(f.negative_count, f.positive_count), f.last_updated),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);

    const preferGenres = data
      .filter(f => f.feature_type === 'genre' && (f.positive_count - f.negative_count) >= 2)
      .map(f => ({
        id: f.feature_id,
        name: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedBoost(f.negative_count, f.positive_count), f.last_updated),
        count: f.positive_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);

    // SUBGENRES: Start avoiding/preferring after 1 net rejection/approval (specific taste signals)
    const avoidSubgenres = data
      .filter(f => f.feature_type === 'subgenre' && (f.negative_count - f.positive_count) >= 1)
      .map(f => ({
        key: f.feature_name, // Subgenre key like 'HORROR_FOLK'
        weight: applyRecencyDecay(calcGraduatedPenalty(f.negative_count, f.positive_count), f.last_updated),
        count: f.negative_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);

    const preferSubgenres = data
      .filter(f => f.feature_type === 'subgenre' && (f.positive_count - f.negative_count) >= 1)
      .map(f => ({
        key: f.feature_name,
        weight: applyRecencyDecay(calcGraduatedBoost(f.negative_count, f.positive_count), f.last_updated),
        count: f.positive_count
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);

    console.log('[PandoraLearning] Loaded graduated preferences', {
      avoidActors: avoidActors.map(a => `${a.name}(${a.count}👎, -${a.weight.toFixed(1)})`).slice(0, 3),
      avoidKeywords: avoidKeywords.map(k => `${k.name}(${k.count}👎)`).slice(0, 5),
      avoidFranchises: avoidFranchises.map(f => f.name),
      avoidDirectors: avoidDirectors.map(d => `${d.name}(${d.count}👎)`).slice(0, 3),
      avoidGenres: avoidGenres.map(g => `${g.name}(${g.count}👎)`).slice(0, 3),
      avoidSubgenres: avoidSubgenres.map(s => `${s.key}(${s.count}👎)`).slice(0, 5),
      preferActors: preferActors.map(a => `${a.name}(${a.count}👍)`).slice(0, 3),
      preferKeywords: preferKeywords.map(k => `${k.name}(${k.count}👍)`).slice(0, 5),
      preferDirectors: preferDirectors.map(d => `${d.name}(${d.count}👍)`).slice(0, 3),
      preferGenres: preferGenres.map(g => `${g.name}(${g.count}👍)`).slice(0, 3),
      preferSubgenres: preferSubgenres.map(s => `${s.key}(${s.count}👍)`).slice(0, 5)
    });

    return { avoidActors, avoidKeywords, avoidFranchises, avoidDirectors, avoidGenres, avoidSubgenres, preferActors, preferKeywords, preferDirectors, preferGenres, preferSubgenres };
  } catch (e) {
    console.error('[PandoraLearning] Error loading graduated features', e);
    return { avoidActors: [], avoidKeywords: [], avoidFranchises: [], avoidDirectors: [], avoidGenres: [], avoidSubgenres: [], preferActors: [], preferKeywords: [], preferDirectors: [], preferGenres: [], preferSubgenres: [] };
  }
}

/**
 * Update user's reason type preferences based on feedback
 */
async function updateReasonPreferences(userId: string, reasonTypes: string[], isPositive: boolean) {
  if (!supabase) return;

  try {
    for (const reasonType of reasonTypes) {
      // Upsert the preference record
      const { data: existing } = await supabase
        .from('user_reason_preferences')
        .select('success_count, total_count')
        .eq('user_id', userId)
        .eq('reason_type', reasonType)
        .maybeSingle();

      const successCount = (existing?.success_count || 0) + (isPositive ? 1 : 0);
      const totalCount = (existing?.total_count || 0) + 1;
      const successRate = totalCount > 0 ? successCount / totalCount : 0.5;

      const { error } = await supabase
        .from('user_reason_preferences')
        .upsert({
          user_id: userId,
          reason_type: reasonType,
          success_count: successCount,
          total_count: totalCount,
          success_rate: successRate,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'user_id,reason_type'
        });

      if (error) {
        console.error('[AdaptiveLearning] Error updating reason preference', { reasonType, error });
      }
    }

    console.log('[AdaptiveLearning] Updated reason preferences', { userId, reasonTypes, isPositive });
  } catch (e) {
    console.error('[AdaptiveLearning] Error in updateReasonPreferences', e);
  }
}

/**
 * Get user's reason type preferences (success rates)
 */
export async function getReasonPreferences(userId: string): Promise<Map<string, number>> {
  if (!supabase) return new Map();

  try {
    const { data, error } = await supabase
      .from('user_reason_preferences')
      .select('reason_type, success_rate, total_count')
      .eq('user_id', userId)
      .gte('total_count', 3); // Minimum sample size

    if (error) {
      console.error('[AdaptiveLearning] Error fetching reason preferences', error);
      return new Map();
    }

    const prefs = new Map<string, number>();
    data?.forEach((row: any) => {
      prefs.set(row.reason_type, row.success_rate);
    });

    return prefs;
  } catch (e) {
    console.error('[AdaptiveLearning] Error in getReasonPreferences', e);
    return new Map();
  }
}

export async function getFeedback(userId: string): Promise<Map<number, 'negative' | 'positive'>> {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase
    .from('suggestion_feedback')
    .select('tmdb_id, feedback_type')
    .eq('user_id', userId);

  if (error) {
    console.error('[Supabase] getFeedback error', { userId, error });
    return new Map();
  }

  const map = new Map<number, 'negative' | 'positive'>();
  data?.forEach((row: any) => {
    map.set(row.tmdb_id, row.feedback_type);
  });
  return map;
}

export async function fetchTmdbMovie(id: number): Promise<TMDBMovie | null> {
  // Fetch from TMDB (primary source)
  console.log('[UnifiedAPI] fetch movie from TMDB', { id });
  const u = new URL('/api/tmdb/movie', getBaseUrl());
  u.searchParams.set('id', String(id));
  u.searchParams.set('_t', String(Date.now())); // Cache buster

  let movie: TMDBMovie;
  try {
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error('[UnifiedAPI] TMDB fetch movie error', { id, status: r.status, body: j });
      if (r.status === 404) return null; // Handle 404 gracefully
      throw new Error(j.error || 'Movie fetch failed');
    }
    console.log('[UnifiedAPI] TMDB fetch movie ok', { id });
    movie = j.movie as TMDBMovie;
  } catch (e) {
    console.error('[UnifiedAPI] TMDB fetch movie exception', { id, error: e });
    throw e;
  }

  // Try to get TuiMDB UID by searching for the movie
  try {
    console.log('[UnifiedAPI] searching TuiMDB for UID', { tmdbId: id, title: movie.title });
    const tuiUrl = new URL('/api/tuimdb/search', getBaseUrl());
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : undefined;
    tuiUrl.searchParams.set('query', movie.title);
    if (year) tuiUrl.searchParams.set('year', String(year));
    tuiUrl.searchParams.set('_t', String(Date.now()));

    const tuiR = await fetch(tuiUrl.toString(), { cache: 'no-store' });
    const tuiJ = await tuiR.json();

    if (tuiR.ok && tuiJ.ok && tuiJ.results?.length > 0) {
      // Use first result (best match)
      const tuimdbUid = tuiJ.results[0].UID;
      console.log('[UnifiedAPI] TuiMDB UID found', { tmdbId: id, tuimdbUid });
      movie.tuimdb_uid = tuimdbUid;

      // Fetch full TuiMDB movie details to get enhanced genres
      try {
        const tuiMovie = await getTuiMDBMovie(tuimdbUid);
        if (tuiMovie && tuiMovie.genres) {
          // Merge TuiMDB genres with TMDB genres
          movie.enhanced_genres = mergeEnhancedGenres(
            movie.genres || [],
            tuiMovie.genres
          );
          console.log('[UnifiedAPI] Enhanced genres merged', {
            tmdbId: id,
            tmdbGenres: movie.genres?.length || 0,
            tuimdbGenres: tuiMovie.genres.length,
            enhancedTotal: movie.enhanced_genres?.length || 0
          });
        }
      } catch (tuiErr) {
        console.warn('[UnifiedAPI] Failed to fetch TuiMDB details', { tuimdbUid, error: tuiErr });
      }
    } else {
      console.log('[UnifiedAPI] TuiMDB UID not found', { tmdbId: id });
    }
  } catch (e) {
    console.log('[UnifiedAPI] TuiMDB UID search failed', { tmdbId: id, error: e });
  }

  return movie;
}

export type FilmEventLite = { uri: string; title: string; year: number | null; rating?: number; liked?: boolean };

function extractFeatures(movie: TMDBMovie) {
  // Use enhanced genres if available (includes TuiMDB data), otherwise fall back to TMDB genres
  const genreSource = (movie as any).enhanced_genres || (movie as any).genres || [];
  const genres: string[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.name).filter(Boolean) : [];
  const genreIds: number[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.id).filter(Boolean) : [];
  const genreSources: string[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.source || 'tmdb') : [];

  // Check for seasonal genres from TuiMDB (e.g., Christmas, Halloween)
  const seasonalInfo = getCurrentSeasonalGenres();
  const hasSeasonalGenre = genreIds.some(id => seasonalInfo.genres.includes(id));
  const directors = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const directorIds = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.id);
  const cast = (movie.credits?.cast || []).slice(0, 5).map((c) => c.name);
  const keywordsList = movie.keywords?.keywords || movie.keywords?.results || [];
  const keywords = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.name);
  const keywordIds = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.id);
  const original_language = (movie as any).original_language as string | undefined;
  const runtime = (movie as any).runtime as number | undefined;

  // Extract production companies/studios
  const productionCompanies = (movie.production_companies || []).map(c => c.name);
  const productionCompanyIds = (movie.production_companies || []).map(c => c.id);

  // Extract collection info
  const collection = movie.belongs_to_collection ? {
    id: movie.belongs_to_collection.id,
    name: movie.belongs_to_collection.name,
    poster_path: movie.belongs_to_collection.poster_path
  } : null;

  // Extract video data (trailers, teasers, etc.)
  const videos = (movie.videos?.results || [])
    .filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .sort((a, b) => {
      // Prioritize official trailers
      if (a.official && !b.official) return -1;
      if (!a.official && b.official) return 1;
      if (a.type === 'Trailer' && b.type !== 'Trailer') return -1;
      if (a.type !== 'Trailer' && b.type === 'Trailer') return 1;
      return 0;
    });

  // Extract lists this movie appears in
  const lists = (movie.lists?.results || [])
    .slice(0, 10) // Limit to top 10 lists
    .map(l => ({ id: l.id, name: l.name, description: l.description, item_count: l.item_count }));

  // Extract high-quality images
  const images = {
    backdrops: (movie.images?.backdrops || [])
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 5)
      .map(i => i.file_path),
    posters: (movie.images?.posters || [])
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 5)
      .map(i => i.file_path)
  };

  // Categorize by vote distribution
  const voteAverage = movie.vote_average || 0;
  const voteCount = movie.vote_count || 0;
  let voteCategory: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard' = 'standard';

  if (voteAverage >= 7.5 && voteCount < 1000) {
    voteCategory = 'hidden-gem';
  } else if (voteAverage >= 7.0 && voteCount > 10000) {
    voteCategory = 'crowd-pleaser';
  } else if (voteAverage >= 7.0 && voteCount >= 1000 && voteCount <= 5000) {
    voteCategory = 'cult-classic';
  }

  // Detect animation/children's/family content markers
  const isAnimation = genres.includes('Animation') || genreIds.includes(16);
  const isFamily = genres.includes('Family') || genreIds.includes(10751);
  const isChildrens = keywords.some(k =>
    k.toLowerCase().includes('children') ||
    k.toLowerCase().includes('kids') ||
    k.toLowerCase().includes('cartoon')
  );

  // Create genre combination signature for more precise matching
  const genreCombo = genres.slice().sort().join('+');

  return {
    genres,
    genreIds,
    genreSources,
    hasSeasonalGenre,
    genreCombo,
    directors,
    directorIds,
    cast,
    productionCompanies,
    productionCompanyIds,
    keywords,
    keywordIds,
    original_language,
    runtime,
    isAnimation,
    isFamily,
    isChildrens,
    collection,
    videos,
    lists,
    images,
    voteCategory,
    voteAverage,
    voteCount
  };
}

// Basic timeout helper for fetches
async function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Fetch with simple cache: prefer Supabase row if present; if missing/partial, fetch from API and upsert
export async function fetchTmdbMovieCached(id: number): Promise<TMDBMovie | null> {
  try {
    if (!supabase) {
      // No database - fetch fresh from TMDB
      const fresh = await withTimeout(fetchTmdbMovie(id));


      // OMDb enrichment is handled server-side through /api/tmdb/movie route
      // Client-side code should not attempt OMDb enrichment

      return fresh;
    }

    // Check cache
    const { data, error } = await supabase
      .from('tmdb_movies')
      .select('data, omdb_fetched_at, imdb_rating')
      .eq('tmdb_id', id)
      .maybeSingle();

    if (!error && data && data.data) {
      const cached = data.data as TMDBMovie;

      // If cached has credits/keywords AND recent OMDb data, use it directly
      const hasCompleteMetadata = (cached.credits && cached.credits.cast && cached.credits.crew) || cached.keywords;
      const hasRecentOMDb = data.omdb_fetched_at &&
        (Date.now() - new Date(data.omdb_fetched_at).getTime()) < (7 * 24 * 60 * 60 * 1000); // 7 days

      if (hasCompleteMetadata && (hasRecentOMDb || !cached.imdb_id)) {
        return cached;
      }

      // OMDb enrichment is handled server-side through /api/tmdb/movie route
      // Client-side code should not attempt to refresh OMDb data
      // Just return the cached data (which may include OMDb fields if previously enriched)

      // Otherwise fall through to refetch enriched details
    }
  } catch {
    // ignore cache errors
  }

  // Fetch from API route which handles both TMDB and OMDb enrichment server-side
  try {
    const apiUrl = new URL('/api/tmdb/movie', getBaseUrl());
    apiUrl.searchParams.set('id', String(id));
    apiUrl.searchParams.set('_t', String(Date.now()));

    const response = await fetch(apiUrl.toString());
    if (!response.ok) {
      if (response.status === 404) return null;
      console.warn('[Enrich] API route failed, falling back to direct TMDB fetch');
      const fresh = await withTimeout(fetchTmdbMovie(id));
      return fresh;
    }

    const json = await response.json();
    if (json.ok && json.movie) {
      return json.movie;
    }

    // Fallback to direct fetch if API response is malformed
    const fresh = await withTimeout(fetchTmdbMovie(id));
    return fresh;
  } catch (apiError) {
    console.warn('[Enrich] API route error, falling back to direct TMDB fetch:', apiError);
    const fresh = await withTimeout(fetchTmdbMovie(id));
    return fresh;
  }
}

// Best-effort refresh of TMDB cache rows for a set of ids.
// Used by UI "refresh posters" actions to backfill missing poster/backdrop
// metadata without changing any mappings.
export async function refreshTmdbCacheForIds(ids: number[]): Promise<void> {
  const distinct = Array.from(new Set(ids.filter(Boolean)));
  if (!distinct.length) return;
  // We intentionally do not parallelize too aggressively here; callers can
  // choose when to invoke this (e.g., behind a button).
  for (const id of distinct) {
    try {
      const fresh = await withTimeout(fetchTmdbMovie(id));
      if (fresh) {
        try {
          await upsertTmdbCache(fresh);
        } catch {
          // ignore individual upsert failures
        }
      }
    } catch {
      // ignore individual fetch failures
    }
  }
}

// Concurrency-limited async mapper
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      ret[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return ret;
}

/**
 * Analyze user's library to find incomplete collections/franchises
 * Returns collections where user has watched some but not all films
 */
export async function findIncompleteCollections(
  watchedFilms: Array<{ tmdbId: number; title: string; rating?: number; liked?: boolean }>
): Promise<Array<{
  collectionId: number;
  collectionName: string;
  watchedCount: number;
  totalCount: number;
  watchedFilms: Array<{ id: number; title: string; rating?: number }>;
  missingFilms: number[];
  avgRating: number;
}>> {
  console.log('[Collections] Analyzing collections', { filmCount: watchedFilms.length });

  // Group films by collection
  const collectionMap = new Map<number, {
    name: string;
    watched: Array<{ id: number; title: string; rating?: number }>;
    ratings: number[];
  }>();

  // Fetch TMDB data for watched films to get collection info
  for (const film of watchedFilms) {
    try {
      const movie = await fetchTmdbMovieCached(film.tmdbId);
      if (!movie?.belongs_to_collection) continue;

      const collId = movie.belongs_to_collection.id;
      if (!collectionMap.has(collId)) {
        collectionMap.set(collId, {
          name: movie.belongs_to_collection.name,
          watched: [],
          ratings: []
        });
      }

      const coll = collectionMap.get(collId)!;
      coll.watched.push({ id: film.tmdbId, title: film.title, rating: film.rating });
      if (film.rating && film.rating >= 4) {
        coll.ratings.push(film.rating);
      }
    } catch (e) {
      console.error(`[Collections] Failed to fetch ${film.tmdbId}`, e);
    }
  }

  console.log('[Collections] Found collections', { count: collectionMap.size });

  // For each collection with watched films, fetch full collection to find missing films
  const incomplete: Array<{
    collectionId: number;
    collectionName: string;
    watchedCount: number;
    totalCount: number;
    watchedFilms: Array<{ id: number; title: string; rating?: number }>;
    missingFilms: number[];
    avgRating: number;
  }> = [];

  for (const [collId, data] of collectionMap.entries()) {
    try {
      // Fetch collection details
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
      if (!apiKey) continue;

      const collUrl = `https://api.themoviedb.org/3/collection/${collId}?api_key=${apiKey}`;
      const r = await fetch(collUrl, { cache: 'no-store' });
      if (!r.ok) continue;

      const collData = await r.json();
      const allParts = (collData.parts || []) as Array<{ id: number }>;
      const watchedIds = new Set(data.watched.map(f => f.id));
      const missingFilms = allParts.filter(p => !watchedIds.has(p.id)).map(p => p.id);

      // Only include if there are missing films and user liked what they've seen
      if (missingFilms.length > 0 && data.ratings.length > 0) {
        const avgRating = data.ratings.reduce((sum, r) => sum + r, 0) / data.ratings.length;

        incomplete.push({
          collectionId: collId,
          collectionName: data.name,
          watchedCount: data.watched.length,
          totalCount: allParts.length,
          watchedFilms: data.watched,
          missingFilms,
          avgRating
        });
      }
    } catch (e) {
      console.error(`[Collections] Failed to fetch collection ${collId}`, e);
    }
  }

  // Sort by avg rating (highest first)
  incomplete.sort((a, b) => b.avgRating - a.avgRating);

  console.log('[Collections] Incomplete collections found', { count: incomplete.length });
  return incomplete;
}

/**
 * Get films from curated lists that contain movies the user loved
 * This discovers hidden connections between films
 */
export async function discoverFromLists(
  seedFilms: Array<{ tmdbId: number; title: string; rating?: number }>
): Promise<number[]> {
  console.log('[Lists] Discovering from curated lists', { seedCount: seedFilms.length });

  // Use top 5 highest-rated films as seeds
  const seeds = seedFilms
    .filter(f => f.rating && f.rating >= 4.5)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 5);

  const discoveredIds = new Set<number>();
  const listIds = new Set<number>();

  // For each seed, get lists it appears in
  for (const seed of seeds) {
    try {
      const movie = await fetchTmdbMovieCached(seed.tmdbId);
      const lists = movie?.lists?.results || [];

      // Add films from lists with substantial content (20+ items)
      for (const list of lists) {
        if (list.item_count && list.item_count >= 20 && list.item_count <= 200) {
          listIds.add(list.id);
        }
      }
    } catch (e) {
      console.error(`[Lists] Failed to fetch lists for ${seed.tmdbId}`, e);
    }
  }

  console.log('[Lists] Found relevant lists', { count: listIds.size });

  // Fetch films from each list (up to 10 lists)
  const limitedLists = Array.from(listIds).slice(0, 10);
  for (const listId of limitedLists) {
    try {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
      if (!apiKey) continue;

      const listUrl = `https://api.themoviedb.org/3/list/${listId}?api_key=${apiKey}`;
      const r = await fetch(listUrl, { cache: 'no-store' });
      if (!r.ok) continue;

      const listData = await r.json();
      const items = (listData.items || []) as Array<{ id: number }>;

      // Add up to 10 films from each list
      items.slice(0, 10).forEach(item => discoveredIds.add(item.id));
    } catch (e) {
      console.error(`[Lists] Failed to fetch list ${listId}`, e);
    }
  }

  console.log('[Lists] Discovered films from lists', { count: discoveredIds.size });
  return Array.from(discoveredIds);
}

/**
 * Build an enhanced taste profile with IDs for TMDB discovery
 * Extracts top genres, keywords, directors, actors, studios with weighted preferences
 * Includes negative signals, user statistics, and recency-aware weighting
 */
export async function buildTasteProfile(params: {
  films: Array<{ uri: string; rating?: number; liked?: boolean; rewatch?: boolean; lastDate?: string }>;
  mappings: Map<string, number>;
  topN?: number;
  negativeFeedbackIds?: number[]; // IDs of movies explicitly dismissed/disliked
  tmdbDetails?: Map<number, any>; // Pre-fetched details to avoid API calls
  watchlistFilms?: Array<{ uri: string; watchlistAddedAt?: string }>; // Watchlist films - show user INTENT
}): Promise<{
  topGenres: Array<{ id: number; name: string; weight: number }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
  topDecades: Array<{ decade: number; weight: number }>;
  topActors: Array<{ id: number; name: string; weight: number }>;
  topStudios: Array<{ id: number; name: string; weight: number }>;
  avoidGenres: Array<{ id: number; name: string; weight: number }>;
  avoidKeywords: Array<{ id: number; name: string; weight: number }>;
  avoidDirectors: Array<{ id: number; name: string; weight: number }>;
  watchlistGenres: string[];
  watchlistKeywords: string[];
  watchlistDirectors: string[];
  userStats: {
    avgRating: number;
    stdDevRating: number;
    totalFilms: number;
    rewatchRate: number;
  };
  nichePreferences: {
    likesAnime: boolean;
    likesStandUp: boolean;
    likesFoodDocs: boolean;
    likesTravelDocs: boolean;
  };
}> {
  const { detectNicheGenres } = await import('./genreEnhancement');

  // Prepare films for niche detection
  const nicheFilms = params.films.map(f => ({
    title: '', // Titles not strictly needed for keyword matching in detectNicheGenres if IDs are present, but we might want them
    genres: [], // detectNicheGenres will need to be robust or we provide IDs
    rating: f.rating,
    liked: f.liked
  }));

  // However, buildTasteProfile in enrich.ts might not have titles for all films.
  // Let's actually use the data we are already collecting in the loop below.
  console.log('=== BUILD TASTE PROFILE START ===');
  console.log('[TasteProfile] Input params:', {
    filmsCount: params.films.length,
    mappingsCount: params.mappings.size,
    topN: params.topN,
    negativeFeedbackCount: params.negativeFeedbackIds?.length ?? 0,
    tmdbDetailsCount: params.tmdbDetails?.size ?? 0,
    watchlistCount: params.watchlistFilms?.length ?? 0,
  });

  const topN = params.topN ?? 10;

  // Calculate user statistics
  const ratedFilms = params.films.filter(f => f.rating != null);
  const ratings = ratedFilms.map(f => f.rating!);
  const avgRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : 3.0;
  const variance = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + Math.pow(r - avgRating, 2), 0) / ratings.length
    : 1.0;
  const stdDevRating = Math.sqrt(variance);
  const rewatchCount = params.films.filter(f => f.rewatch).length;
  const rewatchRate = params.films.length > 0 ? rewatchCount / params.films.length : 0;

  const userStats = {
    avgRating,
    stdDevRating,
    totalFilms: params.films.length,
    rewatchRate
  };

  // Enhanced weighting function with recency and rewatch signals
  const getEnhancedWeight = (film: typeof params.films[0]): number => {
    const r = film.rating ?? avgRating;
    const now = new Date();
    const watchDate = film.lastDate ? new Date(film.lastDate) : new Date();
    const daysSinceWatch = (now.getTime() - watchDate.getTime()) / (1000 * 60 * 60 * 24);

    // Normalize rating to user's scale (z-score), only positive weights
    const normalizedRating = (r - avgRating) / Math.max(stdDevRating, 0.5);
    let weight = Math.max(0, normalizedRating + 1); // Shift to ensure positive

    // Boost for liked films
    if (film.liked) weight *= 1.5;

    // Strong boost for rewatches (indicates strong preference)
    if (film.rewatch) weight *= 1.8;

    // Recency decay (exponential, half-life of 1 year)
    const recencyFactor = Math.exp(-daysSinceWatch / 365);
    weight *= (0.5 + 0.5 * recencyFactor); // 50% base + 50% recency-based

    return weight;
  };

  // === IMPORTANT LOGIC FOR LIKED/DISLIKED ===
  // Letterboxd ratings scale:
  //   0.5-1.5 stars = Bad/Poor (DISLIKE)
  //   2-2.5 stars = Meh/Average (NEUTRAL - not enough signal)
  //   3+ stars = Good (LIKE)
  //
  // CRITICAL: rating = 0 means "no rating" (not "0 stars") - treat same as null!
  // This happens when Letterboxd exports unrated films as 0 instead of empty.
  //
  // A film is considered "liked" if:
  //   1. User clicked the "like" heart, OR
  //   2. User rated it >= 3 stars
  // A film is considered "disliked" if:
  //   1. User rated it 0.5-1.5 stars AND did NOT click "like"
  // A film is NEUTRAL (ignored) if:
  //   1. Just logged without rating or like (rating = null or 0)
  //   2. Rated 2-2.5 stars - "meh" not strong signal

  const DISLIKE_THRESHOLD = 1.5;

  // Helper to check if rating is a real rating (not null/0 which means "no rating")
  const hasRealRating = (rating: number | null | undefined): boolean => {
    return rating != null && rating > 0;
  };

  // Get highly-rated/liked films for positive profile
  const likedFilms = params.films.filter(f =>
    params.mappings.has(f.uri) &&
    (f.liked || (hasRealRating(f.rating) && f.rating! >= 3))
  );

  // Get low-rated films for negative signals
  // IMPORTANT: Only 0.5-1.5 stars counts as dislike
  // rating = 0 means "no rating" NOT "0 stars"!
  // Exclude "liked" films even if rated low (guilty pleasures)
  const dislikedFilms = params.films.filter(f =>
    hasRealRating(f.rating) && f.rating! <= DISLIKE_THRESHOLD && params.mappings.has(f.uri) && !f.liked
  );

  // Count "guilty pleasures" - low-rated but liked films (these are NOT treated as dislikes)
  const guiltyPleasures = params.films.filter(f =>
    f.liked && hasRealRating(f.rating) && f.rating! <= DISLIKE_THRESHOLD && params.mappings.has(f.uri)
  );

  // Count neutral films (logged without strong signal)
  const neutralFilms = params.films.filter(f =>
    params.mappings.has(f.uri) &&
    !f.liked &&
    (!hasRealRating(f.rating) || (f.rating! > DISLIKE_THRESHOLD && f.rating! < 3))
  );

  console.log('[TasteProfile] Film filtering:', {
    totalFilms: params.films.length,
    filmsWithMappings: params.films.filter(f => params.mappings.has(f.uri)).length,
    likedFilmsCount: likedFilms.length,
    dislikedFilmsCount: dislikedFilms.length,
    guiltyPleasuresCount: guiltyPleasures.length,
    neutralFilmsCount: neutralFilms.length,
    dislikeThreshold: DISLIKE_THRESHOLD,
    filmsWithRating0: params.films.filter(f => f.rating === 0).length,
    rewatchFilms: params.films.filter(f => f.rewatch).length,
    likedByLikeFlag: params.films.filter(f => f.liked).length,
    note: 'rating=0 means "no rating" (same as null), not "0 stars"'
  });

  const limit = params.tmdbDetails ? 2000 : 100; // Higher limit if details are pre-fetched

  const likedIds = likedFilms
    .map(f => params.mappings.get(f.uri)!)
    .filter(Boolean)
    .slice(0, limit);

  const dislikedIds = dislikedFilms
    .map(f => params.mappings.get(f.uri)!)
    .filter(Boolean)
    .slice(0, 50); // Cap negative signals

  console.log('[TasteProfile] TMDB IDs to fetch:', {
    likedIdsCount: likedIds.length,
    dislikedIdsCount: dislikedIds.length,
    limit: limit,
  });

  // Fetch movie details (use pre-fetched if available)
  const fetchDetails = async (id: number) => {
    if (params.tmdbDetails?.has(id)) {
      return params.tmdbDetails.get(id);
    }
    return fetchTmdbMovieCached(id);
  };

  const [likedMovies, dislikedMovies, negativeFeedbackMovies] = await Promise.all([
    Promise.all(likedIds.map(id => fetchDetails(id))),
    Promise.all(dislikedIds.map(id => fetchDetails(id))),
    Promise.all((params.negativeFeedbackIds || []).map(id => fetchDetails(id)))
  ]);

  // Log details fetch results
  const likedWithData = likedMovies.filter(m => m != null);
  const likedWithGenres = likedMovies.filter(m => m?.genres?.length > 0);
  const likedWithKeywords = likedMovies.filter(m => {
    const kws = m?.keywords?.keywords || m?.keywords?.results || [];
    return kws.length > 0;
  });
  const likedWithCredits = likedMovies.filter(m => m?.credits?.crew?.length > 0);

  console.log('[TasteProfile] Movie details fetched:', {
    likedMoviesTotal: likedMovies.length,
    likedMoviesWithData: likedWithData.length,
    likedMoviesWithGenres: likedWithGenres.length,
    likedMoviesWithKeywords: likedWithKeywords.length,
    likedMoviesWithCredits: likedWithCredits.length,
    dislikedMoviesTotal: dislikedMovies.length,
    dislikedMoviesWithData: dislikedMovies.filter(m => m != null).length,
    negativeFeedbackMovies: negativeFeedbackMovies.length,
  });

  // Sample a few movies to see their data quality
  if (likedWithData.length > 0) {
    const sample = likedWithData[0];
    console.log('[TasteProfile] Sample movie data:', {
      title: sample?.title,
      genres: sample?.genres?.map((g: any) => g.name),
      keywordCount: (sample?.keywords?.keywords || sample?.keywords?.results || []).length,
      castCount: sample?.credits?.cast?.length ?? 0,
      crewCount: sample?.credits?.crew?.length ?? 0,
      directors: sample?.credits?.crew?.filter((c: any) => c.job === 'Director').map((d: any) => d.name),
    });
  }

  // Positive profile weights
  const genreWeights = new Map<number, { name: string; weight: number }>();
  const keywordWeights = new Map<number, { name: string; weight: number }>();
  const directorWeights = new Map<number, { name: string; weight: number }>();
  const actorWeights = new Map<number, { name: string; weight: number }>();
  const studioWeights = new Map<number, { name: string; weight: number }>();
  const decadeWeights = new Map<number, number>();

  // Negative profile weights
  const avoidGenreWeights = new Map<number, { name: string; weight: number }>();
  const avoidKeywordWeights = new Map<number, { name: string; weight: number }>();
  const avoidDirectorWeights = new Map<number, { name: string; weight: number }>();

  // Track COUNTS of liked vs disliked for ratio-based avoidance
  // Only avoid something if user dislikes MORE than they like
  const genreLikedCounts = new Map<number, number>();
  const keywordLikedCounts = new Map<number, number>();
  const directorLikedCounts = new Map<number, number>();
  const genreDislikedCounts = new Map<number, number>();
  const keywordDislikedCounts = new Map<number, number>();
  const directorDislikedCounts = new Map<number, number>();

  // Accumulate positive weighted preferences
  for (let i = 0; i < likedMovies.length; i++) {
    const movie = likedMovies[i];
    if (!movie) continue;

    const film = likedFilms[i];
    const weight = getEnhancedWeight(film);
    const feats = extractFeatures(movie);

    // Decades
    if (movie.release_date) {
      const year = parseInt(movie.release_date.slice(0, 4));
      if (!isNaN(year)) {
        const decade = Math.floor(year / 10) * 10;
        decadeWeights.set(decade, (decadeWeights.get(decade) || 0) + weight);
      }
    }

    // Genres with IDs - FRACTIONAL WEIGHTING
    // Divide weight among genres so multi-genre films don't over-inflate all genres
    const genreCount = feats.genreIds.length;
    const genreFraction = genreCount > 0 ? 1 / Math.sqrt(genreCount) : 1; // Use sqrt for moderate dampening
    feats.genreIds.forEach((id, idx) => {
      const name = feats.genres[idx];
      const current = genreWeights.get(id) || { name, weight: 0 };
      genreWeights.set(id, { name, weight: current.weight + (weight * genreFraction) });
      // Track count for ratio-based avoidance
      genreLikedCounts.set(id, (genreLikedCounts.get(id) || 0) + 1);
    });

    // Keywords with IDs - apply similar fractional weighting
    const keywordCount = feats.keywordIds.length;
    const keywordFraction = keywordCount > 0 ? 1 / Math.sqrt(Math.min(keywordCount, 10)) : 1;
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = keywordWeights.get(id) || { name, weight: 0 };
      keywordWeights.set(id, { name, weight: current.weight + (weight * keywordFraction) });
      // Track count for ratio-based avoidance
      keywordLikedCounts.set(id, (keywordLikedCounts.get(id) || 0) + 1);
    });

    // Directors with IDs
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = directorWeights.get(id) || { name, weight: 0 };
      directorWeights.set(id, { name, weight: current.weight + weight });
      // Track count for ratio-based avoidance
      directorLikedCounts.set(id, (directorLikedCounts.get(id) || 0) + 1);
    });

    // Actors with IDs (top 5 billed, with billing position weighting)
    const castData = movie.credits?.cast || [];
    castData.slice(0, 5).forEach((actor: { id: number; name: string }, idx: number) => {
      const billingWeight = 1 / (idx + 1); // Lead = 1.0, 2nd = 0.5, 3rd = 0.33, etc.
      const current = actorWeights.get(actor.id) || { name: actor.name, weight: 0 };
      actorWeights.set(actor.id, {
        name: actor.name,
        weight: current.weight + (weight * billingWeight)
      });
    });

    // Production companies/studios with IDs
    feats.productionCompanyIds.forEach((id, idx) => {
      const name = feats.productionCompanies[idx];
      const current = studioWeights.get(id) || { name, weight: 0 };
      studioWeights.set(id, { name, weight: current.weight + weight });
    });
  }

  // Accumulate negative signals from disliked films
  // NOTE: Only avoid if user dislikes MORE than they like (ratio-based)
  // Only films rated <= 1.5 stars are considered "disliked"

  for (let i = 0; i < dislikedMovies.length; i++) {
    const movie = dislikedMovies[i];
    if (!movie) continue;

    const film = dislikedFilms[i];
    // Use a scaled weight based on how bad the rating is
    // 0.5 stars = 1.0 weight, 1 star = 0.5 weight, 1.5 stars = 0 weight
    const negWeight = Math.max(0, (DISLIKE_THRESHOLD - (film.rating ?? DISLIKE_THRESHOLD)) * 1.0);
    const feats = extractFeatures(movie);

    // Count disliked films per genre/keyword/director (for ratio checking)
    feats.genreIds.forEach(id => {
      genreDislikedCounts.set(id, (genreDislikedCounts.get(id) || 0) + 1);
    });
    feats.keywordIds.forEach(id => {
      keywordDislikedCounts.set(id, (keywordDislikedCounts.get(id) || 0) + 1);
    });
    feats.directorIds.forEach(id => {
      directorDislikedCounts.set(id, (directorDislikedCounts.get(id) || 0) + 1);
    });

    // Genres to avoid - weights accumulated for final selection
    feats.genreIds.forEach((id, idx) => {
      const name = feats.genres[idx];
      const current = avoidGenreWeights.get(id) || { name, weight: 0 };
      avoidGenreWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Keywords to avoid
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = avoidKeywordWeights.get(id) || { name, weight: 0 };
      avoidKeywordWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Directors to avoid
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = avoidDirectorWeights.get(id) || { name, weight: 0 };
      avoidDirectorWeights.set(id, { name, weight: current.weight + negWeight });
    });
  }

  // Accumulate negative signals from explicitly dismissed/negative feedback movies
  // NOTE: We only learn director/keyword avoidance from these, NOT genre avoidance
  // Reason: Blocking "Fast X" doesn't mean you hate Action - you just don't want that specific movie
  // Genre preferences should only come from actual watched film ratings
  for (const movie of negativeFeedbackMovies) {
    if (!movie) continue;

    const negWeight = 3.0; // Strong penalty for explicitly dismissed items
    const feats = extractFeatures(movie);

    // Do NOT learn genre avoidance from blocked movies - that's too aggressive
    // A user blocking Harry Potter doesn't mean they hate Fantasy

    // Keywords are more specific, so still learn from those (but with reduced weight)
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = avoidKeywordWeights.get(id) || { name, weight: 0 };
      // Use lower weight (1.0) for blocked movies vs disliked (negWeight varies)
      avoidKeywordWeights.set(id, { name, weight: current.weight + 1.0 });
    });

    // Directors to avoid - this makes sense (user may dislike a specific director's style)
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = avoidDirectorWeights.get(id) || { name, weight: 0 };
      avoidDirectorWeights.set(id, { name, weight: current.weight + negWeight });
    });
  }

  // === WATCHLIST PROCESSING ===
  // Watchlist shows user INTENT - what they WANT to see
  // This is a positive signal that should:
  // 1. Boost preferences for genres/keywords/directors on watchlist
  // 2. Override avoidance signals (if user has X on watchlist, don't avoid X)

  const watchlistGenreIds = new Set<number>();
  const watchlistKeywordIds = new Set<number>();
  const watchlistDirectorIds = new Set<number>();
  const watchlistGenreNames = new Set<string>();
  const watchlistKeywordNames = new Set<string>();
  const watchlistDirectorNames = new Set<string>();

  if (params.watchlistFilms && params.watchlistFilms.length > 0) {
    console.log('[TasteProfile] Processing watchlist for intent signals:', {
      watchlistCount: params.watchlistFilms.length
    });

    // Get TMDB IDs for watchlist films
    const watchlistEntries = params.watchlistFilms
      .map(f => {
        const id = params.mappings.get(f.uri);
        const addedAt = f.watchlistAddedAt ?? null;
        return { id, addedAt };
      })
      .filter((row): row is { id: number; addedAt: string | null } => typeof row.id === 'number')
      .slice(0, 200); // Cap to avoid too many API calls

    const watchlistIds = watchlistEntries.map(r => r.id);

    console.log('[TasteProfile] Watchlist TMDB IDs found:', watchlistIds.length);

    // Fetch details for watchlist films
    const watchlistMovies = await Promise.all(
      watchlistIds.map(id => fetchDetails(id))
    );

    const WATCHLIST_WEIGHT = 0.5; // Base boost for watchlist items

    const recencyScore = (addedAt?: string | null) => {
      if (!addedAt) return 0.0;
      const days = Math.max(1, (Date.now() - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24));
      // Recent additions (<30d) get up to +0.4, decays after
      if (days <= 30) return 0.4;
      if (days <= 90) return 0.25;
      if (days <= 180) return 0.1;
      return 0.0;
    };

    const freshnessMultiplier = (addedAt?: string | null) => {
      if (!addedAt) return 0.25; // Unknown age: keep a small intent signal
      const days = Math.max(1, (Date.now() - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 90) return 1.0;
      if (days <= 180) return 0.7;
      if (days <= 365) return 0.45;
      return 0.2; // Stale watchlist entries still count but lightly
    };

    const repetitionBoost = (id: number) => {
      // Multiple entries of same TMDB id on watchlist -> intent
      const occurrences = watchlistIds.filter(x => x === id).length;
      if (occurrences >= 3) return 0.3;
      if (occurrences === 2) return 0.15;
      return 0;
    };

    for (let i = 0; i < watchlistMovies.length; i++) {
      const movie = watchlistMovies[i];
      const entry = watchlistEntries[i];
      if (!movie || !entry) continue;

      const feats = extractFeatures(movie);
      const recBoost = recencyScore(entry.addedAt);
      const repBoost = entry.id ? repetitionBoost(entry.id) : 0;
      const ageMultiplier = freshnessMultiplier(entry.addedAt);
      const totalBoost = WATCHLIST_WEIGHT * ageMultiplier + recBoost + repBoost;

      // Track genres user WANTS to see (for override logic)
      feats.genreIds.forEach((id, idx) => {
        // Boost with recency/repetition intent
        const name = feats.genres[idx];
        watchlistGenreIds.add(id);
        if (name) watchlistGenreNames.add(name);
        const current = genreWeights.get(id) || { name, weight: 0 };
        genreWeights.set(id, { name, weight: current.weight + totalBoost });
        // Count as "liked" for ratio calculation
        genreLikedCounts.set(id, (genreLikedCounts.get(id) || 0) + 1);
      });

      // Track keywords user WANTS to see
      feats.keywordIds.forEach((id, idx) => {
        const name = feats.keywords[idx];
        watchlistKeywordIds.add(id);
        if (name) watchlistKeywordNames.add(name);
        const current = keywordWeights.get(id) || { name, weight: 0 };
        keywordWeights.set(id, { name, weight: current.weight + totalBoost });
        keywordLikedCounts.set(id, (keywordLikedCounts.get(id) || 0) + 1);
      });

      // Track directors user WANTS to see
      feats.directorIds.forEach((id, idx) => {
        const name = feats.directors[idx];
        watchlistDirectorIds.add(id);
        if (name) watchlistDirectorNames.add(name);
        const current = directorWeights.get(id) || { name, weight: 0 };
        directorWeights.set(id, { name, weight: current.weight + totalBoost });
        directorLikedCounts.set(id, (directorLikedCounts.get(id) || 0) + 1);
      });
    }

    console.log('[TasteProfile] Watchlist signals extracted:', {
      genresOnWatchlist: watchlistGenreIds.size,
      keywordsOnWatchlist: watchlistKeywordIds.size,
      directorsOnWatchlist: watchlistDirectorIds.size,
    });
  }

  // Sort and return top N for each category
  // Sort and return top N for each category
  const topGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topKeywords = Array.from(keywordWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  // Source reliability is calculated later when enriching suggestions; placeholder here for parity
  const sourceReliability: Array<{ source: string; reliability: number }> = [];

  const topDirectors = Array.from(directorWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topActors = Array.from(actorWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topStudios = Array.from(studioWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topDecades = Array.from(decadeWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([decade, weight]) => ({ decade, weight }));

  // === RATIO-BASED AVOIDANCE ===
  // Only avoid something if user dislikes MORE than they like (>60% dislike ratio)
  // AND it's not on the user's watchlist (watchlist = explicit interest override)
  // This prevents the system from avoiding things the user actually enjoys

  const MIN_DISLIKED_FOR_AVOIDANCE = 3;
  const MIN_DISLIKE_RATIO = 0.6; // Must dislike 60%+ of films with this attribute

  // Helper to check if item should be avoided based on ratio
  const shouldAvoid = (likedCount: number, dislikedCount: number, minDisliked: number): boolean => {
    if (dislikedCount < minDisliked) return false;
    const total = likedCount + dislikedCount;
    const dislikeRatio = dislikedCount / total;
    return dislikeRatio >= MIN_DISLIKE_RATIO;
  };

  // Log items that WON'T be avoided because user likes them more than dislikes
  const protectedByRatio: string[] = [];
  const protectedByWatchlist: string[] = [];

  // Filter genres by ratio - only avoid if dislike ratio >= 60% AND not on watchlist
  const avoidGenres = Array.from(avoidGenreWeights.entries())
    .filter(([id, { name }]) => {
      // Check watchlist override first
      if (watchlistGenreIds.has(id)) {
        protectedByWatchlist.push(`${name}(genre on watchlist)`);
        return false;
      }
      const liked = genreLikedCounts.get(id) || 0;
      const disliked = genreDislikedCounts.get(id) || 0;
      if (disliked >= MIN_DISLIKED_FOR_AVOIDANCE && !shouldAvoid(liked, disliked, MIN_DISLIKED_FOR_AVOIDANCE)) {
        protectedByRatio.push(`${name}(${liked}👍/${disliked}👎)`);
        return false;
      }
      return shouldAvoid(liked, disliked, MIN_DISLIKED_FOR_AVOIDANCE);
    })
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  if (protectedByRatio.length > 0) {
    console.log('[TasteProfile] Genres NOT avoided because user likes them more:', protectedByRatio);
  }
  if (protectedByWatchlist.length > 0) {
    console.log('[TasteProfile] Items NOT avoided due to watchlist interest:', protectedByWatchlist);
  }

  console.log('[TasteProfile] Genre avoidance analysis:', {
    genresWithBothLikedAndDisliked: Array.from(genreDislikedCounts.entries())
      .filter(([id]) => (genreLikedCounts.get(id) || 0) > 0)
      .map(([id, disliked]) => {
        const data = avoidGenreWeights.get(id);
        const liked = genreLikedCounts.get(id) || 0;
        return `${data?.name || id}(${liked}👍/${disliked}👎)`;
      }).slice(0, 8),
    finalAvoidGenres: avoidGenres.map(g => g.name)
  });

  // Filter keywords by ratio - also check watchlist override
  const protectedKeywordsByRatio: string[] = [];
  const avoidKeywords = Array.from(avoidKeywordWeights.entries())
    .filter(([id, { name }]) => {
      // Check watchlist override first
      if (watchlistKeywordIds.has(id)) {
        protectedByWatchlist.push(`${name}(keyword on watchlist)`);
        return false;
      }
      const liked = keywordLikedCounts.get(id) || 0;
      const disliked = keywordDislikedCounts.get(id) || 0;
      if (disliked >= 2 && !shouldAvoid(liked, disliked, 2)) {
        protectedKeywordsByRatio.push(`${name}(${liked}👍/${disliked}👎)`);
        return false;
      }
      return shouldAvoid(liked, disliked, 2);
    })
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  if (protectedKeywordsByRatio.length > 0) {
    console.log('[TasteProfile] Keywords NOT avoided because user likes them more:',
      protectedKeywordsByRatio.slice(0, 10));
  }

  // Filter directors by ratio - also check watchlist override
  const protectedDirectorsByRatio: string[] = [];
  const avoidDirectors = Array.from(avoidDirectorWeights.entries())
    .filter(([id, { name }]) => {
      // Check watchlist override first
      if (watchlistDirectorIds.has(id)) {
        protectedByWatchlist.push(`${name}(director on watchlist)`);
        return false;
      }
      const liked = directorLikedCounts.get(id) || 0;
      const disliked = directorDislikedCounts.get(id) || 0;
      if (disliked >= 2 && !shouldAvoid(liked, disliked, 2)) {
        protectedDirectorsByRatio.push(`${name}(${liked}👍/${disliked}👎)`);
        return false;
      }
      return shouldAvoid(liked, disliked, 2);
    })
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 3)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  if (protectedDirectorsByRatio.length > 0) {
    console.log('[TasteProfile] Directors NOT avoided because user likes them more:',
      protectedDirectorsByRatio);
  }

  console.log('[TasteProfile] Enhanced profile built', {
    topGenres: topGenres.slice(0, 3).map(g => `${g.name}(${g.weight.toFixed(1)})`),
    topKeywords: topKeywords.slice(0, 3).map(k => `${k.name}(${k.weight.toFixed(1)})`),
    topDirectors: topDirectors.slice(0, 3).map(d => `${d.name}(${d.weight.toFixed(1)})`),
    topActors: topActors.slice(0, 3).map(a => `${a.name}(${a.weight.toFixed(1)})`),
    topStudios: topStudios.slice(0, 3).map(s => `${s.name}(${s.weight.toFixed(1)})`),
    topDecades: topDecades.map(d => `${d.decade}s(${d.weight.toFixed(1)})`),
    avoidGenres: avoidGenres.map(g => g.name),
    avoidKeywords: avoidKeywords.map(k => k.name),
    avoidDirectors: avoidDirectors.map(d => d.name),
    watchlistOverrides: protectedByWatchlist.length,
    userStats: {
      avgRating: avgRating.toFixed(2),
      stdDev: stdDevRating.toFixed(2),
      rewatchRate: (rewatchRate * 100).toFixed(1) + '%'
    }
  });

  console.log('=== BUILD TASTE PROFILE END ===');

  // Issue #7: Detect niche genre preferences
  const nicheFilmsForDetection = likedFilms.map(f => {
    const tmdbId = params.mappings.get(f.uri);
    const details = tmdbId ? params.tmdbDetails?.get(tmdbId) : null;
    return {
      title: details?.title || f.uri.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '',
      genres: details?.genres?.map((g: any) => g.name) || [],
      rating: f.rating,
      liked: f.liked
    };
  });

  const nichePreferences = detectNicheGenres(nicheFilmsForDetection);

  return {
    topGenres,
    topKeywords,
    topDirectors,
    topDecades,
    topActors,
    topStudios,
    avoidGenres,
    avoidKeywords,
    avoidDirectors,
    watchlistGenres: Array.from(watchlistGenreNames),
    watchlistKeywords: Array.from(watchlistKeywordNames),
    watchlistDirectors: Array.from(watchlistDirectorNames),
    userStats,
    nichePreferences
  };
}

/**
 * Apply diversity filtering to prevent too many similar suggestions
 * Limits the number of films from the same director, genre, decade, studio, or actor
 */
function applyDiversityFilter<T extends {
  directors?: string[];
  genres?: string[];
  release_date?: string;
  studios?: string[];
  actors?: string[];
  score: number;
}>(
  suggestions: T[],
  options?: {
    maxSameDirector?: number;
    maxSameGenre?: number;
    maxSameDecade?: number;
    maxSameStudio?: number;
    maxSameActor?: number;
  }
): T[] {
  const defaults = {
    maxSameDirector: 2,
    maxSameGenre: 5,
    maxSameDecade: 4,
    maxSameStudio: 3,
    maxSameActor: 3
  };

  const limits = { ...defaults, ...options };

  // Track counts
  const directorCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const decadeCounts = new Map<number, number>();
  const studioCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();

  const filtered: T[] = [];
  let skippedCount = 0;

  for (const suggestion of suggestions) {
    let shouldInclude = true;
    const skipReasons: string[] = [];

    // Check directors
    if (shouldInclude && suggestion.directors) {
      for (const director of suggestion.directors) {
        if ((directorCounts.get(director) || 0) >= limits.maxSameDirector) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameDirector} from ${director}`);
          break;
        }
      }
    }

    // Check genres (primary genre only)
    if (shouldInclude && suggestion.genres && suggestion.genres.length > 0) {
      const primaryGenre = suggestion.genres[0];
      if ((genreCounts.get(primaryGenre) || 0) >= limits.maxSameGenre) {
        shouldInclude = false;
        skipReasons.push(`max ${limits.maxSameGenre} ${primaryGenre} films`);
      }
    }

    // Check decade
    if (shouldInclude && suggestion.release_date) {
      const year = parseInt(suggestion.release_date.slice(0, 4));
      if (!isNaN(year)) {
        const decade = Math.floor(year / 10) * 10;
        if ((decadeCounts.get(decade) || 0) >= limits.maxSameDecade) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameDecade} from ${decade}s`);
        }
      }
    }

    // Check studios
    if (shouldInclude && suggestion.studios) {
      for (const studio of suggestion.studios) {
        if ((studioCounts.get(studio) || 0) >= limits.maxSameStudio) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameStudio} from ${studio}`);
          break;
        }
      }
    }

    // Check actors (top billed only)
    if (shouldInclude && suggestion.actors) {
      for (const actor of suggestion.actors.slice(0, 2)) {
        if ((actorCounts.get(actor) || 0) >= limits.maxSameActor) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameActor} with ${actor}`);
          break;
        }
      }
    }

    if (shouldInclude) {
      filtered.push(suggestion);

      // Update counts
      if (suggestion.directors) {
        for (const director of suggestion.directors) {
          directorCounts.set(director, (directorCounts.get(director) || 0) + 1);
        }
      }
      if (suggestion.genres && suggestion.genres.length > 0) {
        const primaryGenre = suggestion.genres[0];
        genreCounts.set(primaryGenre, (genreCounts.get(primaryGenre) || 0) + 1);
      }
      if (suggestion.release_date) {
        const year = parseInt(suggestion.release_date.slice(0, 4));
        if (!isNaN(year)) {
          const decade = Math.floor(year / 10) * 10;
          decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
        }
      }
      if (suggestion.studios) {
        for (const studio of suggestion.studios) {
          studioCounts.set(studio, (studioCounts.get(studio) || 0) + 1);
        }
      }
      if (suggestion.actors) {
        for (const actor of suggestion.actors.slice(0, 2)) {
          actorCounts.set(actor, (actorCounts.get(actor) || 0) + 1);
        }
      }
    } else {
      skippedCount++;
    }
  }

  console.log('[DiversityFilter] Applied diversity filtering', {
    original: suggestions.length,
    filtered: filtered.length,
    skipped: skippedCount,
    directorCounts: Array.from(directorCounts.entries()).filter(([_, count]) => count > 1).slice(0, 3),
    genreCounts: Array.from(genreCounts.entries()).slice(0, 5)
  });

  return filtered;
}

// Maximal Marginal Relevance (MMR) reranking to balance relevance and diversity
function applyMMRRerank<T extends {
  score: number;
  genres?: string[];
  directors?: string[];
  studios?: string[];
  actors?: string[];
  release_date?: string;
}>(
  suggestions: T[],
  options?: {
    lambda?: number; // relevance weight (0..1). Higher = more relevance, lower = more diversity
    topK?: number;   // how many items to rerank with MMR before appending the rest
  }
): T[] {
  if (suggestions.length <= 1) return suggestions;

  const lambda = options?.lambda ?? 0.25;
  const topK = Math.min(options?.topK ?? suggestions.length, suggestions.length);
  const pool = [...suggestions];
  const selected: T[] = [];
  const topScore = pool[0].score || 1;

  const toSet = (arr?: string[]) => new Set((arr || []).filter(Boolean));
  const decadeFromDate = (date?: string) => {
    if (!date || date.length < 4) return null;
    const year = parseInt(date.slice(0, 4), 10);
    if (Number.isNaN(year)) return null;
    return Math.floor(year / 10) * 10;
  };

  const jaccard = (a: Set<string>, b: Set<string>) => {
    if (!a.size && !b.size) return 0;
    const intersection = [...a].filter((x) => b.has(x)).length;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  };

  const similarity = (a: T, b: T) => {
    const genreSim = jaccard(toSet(a.genres), toSet(b.genres));
    const directorSim = jaccard(toSet(a.directors), toSet(b.directors));
    const studioSim = jaccard(toSet(a.studios), toSet(b.studios));
    const actorSim = jaccard(toSet(a.actors), toSet(b.actors));

    const da = decadeFromDate(a.release_date);
    const db = decadeFromDate(b.release_date);
    const decadeSim = da !== null && db !== null && da === db ? 1 : 0;

    // Weighted blend, capped at 1.0
    const blended = (genreSim * 0.4) + (directorSim * 0.25) + (actorSim * 0.2) + (studioSim * 0.1) + (decadeSim * 0.05);
    return Math.min(1, blended);
  };

  while (selected.length < topK && pool.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      const relevance = cand.score / topScore;
      let diversityPenalty = 0;

      if (selected.length > 0) {
        diversityPenalty = Math.max(...selected.map((s) => similarity(s, cand)));
      }

      const mmrScore = (lambda * relevance) - ((1 - lambda) * diversityPenalty);
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(pool[bestIdx]);
    pool.splice(bestIdx, 1);
  }

  // Append any remaining items in their original relative order
  return [...selected, ...pool];
}

export async function suggestByOverlap(params: {
  userId: string;
  films: FilmEventLite[];
  mappings: Map<string, number>;
  candidates: number[]; // tmdb ids to consider (e.g., from watchlist mapping or popular)
  excludeGenres?: Set<string>;
  maxCandidates?: number;
  concurrency?: number;
  excludeWatchedIds?: Set<number>;
  desiredResults?: number;
  context?: SuggestContext;
  feedbackMap?: Map<number, 'negative' | 'positive'>;
  // Multi-source metadata for badge display
  sourceMetadata?: Map<number, { sources: string[]; consensusLevel: 'high' | 'medium' | 'low' }>;
  // Optional per-user reliability weights by source (1.0 = neutral)
  sourceReliability?: Map<string, number>;
  // Optional MMR tuning
  mmrLambda?: number;
  mmrTopKFactor?: number;
  // Watchlist entries with recency for intent reasons
  watchlistEntries?: Array<{ tmdbId: number; addedAt?: string | null }>;
  // Feature-level feedback from "Not Interested" / "More Like This" clicks (Pandora-style)
  featureFeedback?: {
    avoidActors: Array<{ id: number; name: string; weight: number; count: number }>;
    avoidKeywords: Array<{ id: number; name: string; weight: number; count: number }>;
    avoidFranchises: Array<{ id: number; name: string; weight: number; count: number }>;
    avoidDirectors: Array<{ id: number; name: string; weight: number; count: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number; count: number }>;
    avoidSubgenres: Array<{ key: string; weight: number; count: number }>; // e.g., HORROR_FOLK
    preferActors: Array<{ id: number; name: string; weight: number; count: number }>;
    preferKeywords: Array<{ id: number; name: string; weight: number; count: number }>;
    preferDirectors: Array<{ id: number; name: string; weight: number; count: number }>;
    preferGenres: Array<{ id: number; name: string; weight: number; count: number }>;
    preferSubgenres: Array<{ key: string; weight: number; count: number }>; // e.g., HORROR_FOLK
  };
  enhancedProfile?: {
    topActors: Array<{ id: number; name: string; weight: number }>;
    topStudios: Array<{ id: number; name: string; weight: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number }>;
    avoidKeywords: Array<{ id: number; name: string; weight: number }>;
    avoidDirectors: Array<{ id: number; name: string; weight: number }>;
    adjacentGenres?: Map<string, Array<{ genre: string; weight: number }>>; // Adaptive learning transitions
    recentGenres?: string[]; // Recent genres to trigger transitions
    topDecades?: Array<{ decade: number; weight: number }>; // User's preferred eras
    watchlistGenres?: string[];
    watchlistKeywords?: string[];
    watchlistDirectors?: string[];
  };
  // Recent exposures for repeat penalty (Map of tmdbId -> days since exposure)
  recentExposures?: Map<number, number>;
}): Promise<Array<{
  tmdbId: number;
  score: number;
  reasons: string[];
  title?: string;
  release_date?: string;
  genres?: string[];
  poster_path?: string | null;
  voteCategory?: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard';
  voteAverage?: number;
  voteCount?: number;
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
  // Phase 3: For diversity filtering
  directors?: string[];
  studios?: string[];
  actors?: string[];
  // Multi-source recommendation data
  sources?: string[];
  consensusLevel?: 'high' | 'medium' | 'low';
  reliabilityMultiplier?: number;
  metadataCompleteness?: number;
}>> {
  // Build user profile from liked/highly-rated mapped films.
  // Use as much history as possible, but cap TMDB fetches to avoid huge fan-out
  // for extremely large libraries. We bias towards the most recent entries when
  // trimming.
  const liked = params.films.filter((f) => (f.liked || (f.rating ?? 0) >= 4) && params.mappings.get(f.uri));
  const likedIdsAll = liked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];

  // Fetch user feedback to adjust weights and filter candidates
  const feedbackMap = params.feedbackMap ?? await getFeedback(params.userId);
  const negativeFeedbackIds = new Set<number>();
  const positiveFeedbackIds = new Set<number>();

  const context = deriveContextMode(params.context);

  const applyContextBias = (
    feats: ReturnType<typeof extractFeatures>,
    movie: TMDBMovie
  ): { delta: number; reasons: string[]; filtered?: boolean } => {
    let delta = 0;
    const reasons: string[] = [];
    const runtime = feats.runtime ?? (movie as any).runtime as number | undefined;
    const rating = (movie as any).rated as string | undefined;
    const genresLower = feats.genres.map((g) => g.toLowerCase());
    const hasGenre = (needle: string) => genresLower.some((g) => g.includes(needle));
    const isHorror = hasGenre('horror');
    const isThriller = hasGenre('thriller');
    const isCrime = hasGenre('crime');

    switch (context.mode) {
      case 'family': {
        // Hard filter: avoid horror/thriller/crime and R/NC-17 ratings in family mode
        const ratingUpper = rating?.toUpperCase() || '';
        if (isHorror || isThriller || isCrime) return { delta: 0, reasons, filtered: true };
        if (ratingUpper.startsWith('R') || ratingUpper.includes('NC-17')) return { delta: 0, reasons, filtered: true };

        if (hasGenre('family') || hasGenre('animation')) {
          delta += 1.1;
          reasons.push('Family/animation friendly pick for this session');
        } else if (hasGenre('adventure') || hasGenre('comedy')) {
          delta += 0.6;
          reasons.push('Light adventure/comedy that works for family time');
        }

        if (runtime && runtime >= 85 && runtime <= 125) {
          delta += 0.35;
          reasons.push(`Runtime fits a family window (~${runtime}m)`);
        }
        break;
      }

      case 'short': {
        if (runtime) {
          if (runtime <= 105) {
            delta += 0.9;
            reasons.push(`Tight runtime for a quick watch (~${runtime}m)`);
          } else if (runtime <= 125) {
            delta += 0.35;
            reasons.push(`Weeknight-friendly length (~${runtime}m)`);
          } else if (runtime >= 145) {
            delta -= 0.9;
            reasons.push('Long for a short-session pick');
          }
        }

        if (hasGenre('comedy') || hasGenre('romance') || hasGenre('animation')) {
          delta += 0.35;
          reasons.push('Lighter tone suited to a short session');
        }

        if (feats.voteCategory === 'crowd-pleaser') {
          delta += 0.25;
          reasons.push('Crowd-pleaser fits quick-watch mood');
        }
        break;
      }

      case 'weeknight': {
        if (runtime) {
          if (runtime <= 130) {
            delta += 0.6;
            reasons.push(`Weeknight-friendly runtime (~${runtime}m)`);
          } else if (runtime >= 150) {
            delta -= 0.7;
            reasons.push('Probably too long for a weeknight');
          }
        }

        if (feats.voteAverage >= 7.0) {
          delta += 0.2;
          reasons.push('Reliable pick for a school-night watch');
        }

        if (hasGenre('comedy') || hasGenre('thriller') || hasGenre('romance')) {
          delta += 0.25;
          reasons.push('Easy-to-watch tone for a weekday');
        }
        break;
      }

      case 'immersive': {
        if (runtime && runtime >= 130) {
          delta += 0.9;
          reasons.push(`Longer runtime suits an immersive session (~${runtime}m)`);
        }

        if (feats.voteAverage >= 7.5) {
          delta += 0.5;
          reasons.push('High-rated pick for a deeper watch');
        }

        if (hasGenre('drama') || hasGenre('mystery') || hasGenre('science fiction')) {
          delta += 0.35;
          reasons.push('Narrative-forward fit for immersive mode');
        }
        break;
      }

      case 'background': {
        if (runtime) {
          if (runtime >= 80 && runtime <= 115) {
            delta += 0.5;
            reasons.push(`Manageable runtime for background viewing (~${runtime}m)`);
          } else if (runtime >= 145) {
            delta -= 0.8;
            reasons.push('Too long for background viewing');
          }
        }

        if (feats.voteCategory === 'crowd-pleaser') {
          delta += 0.35;
          reasons.push('Crowd-pleaser works well while multitasking');
        }

        if ((movie as any).original_language === 'en') {
          delta += 0.2;
          reasons.push('English-language makes for easy background play');
        }

        if (isHorror || isCrime) {
          delta -= 0.4;
          reasons.push('Heavier tone than ideal for background viewing');
        }
        break;
      }
    }

    return { delta, reasons };
  };

  for (const [id, type] of feedbackMap.entries()) {
    if (type === 'negative') negativeFeedbackIds.add(id);
    else if (type === 'positive') positiveFeedbackIds.add(id);
  }

  // Filter out candidates with negative feedback
  // We modify the input candidates array in place or filter it
  // But wait, candidates is a number[], we should filter it before processing?
  // The function signature takes candidates as input.
  // However, the logic below uses `candidates` to find overlaps.
  // We should filter `candidates` here if possible, but `candidates` is passed in.
  // Let's filter it effectively by ignoring them during scoring or just removing them from the set if we could.
  // Actually, `suggestByOverlap` iterates over `candidates` later?
  // No, it iterates over `params.films` (the user's library) and finds overlaps with `candidates`.
  // Wait, let's check how `candidates` is used.

  // Also identify watched but NOT liked films for negative signals
  // IMPORTANT: Respect the "liked" flag - a user may rate a movie low but still enjoy it (guilty pleasure)
  // Only consider it "disliked" if: rated < 2.5 AND NOT marked as liked
  const watchedNotLiked = params.films.filter((f) =>
    !f.liked &&                           // Not marked as liked (guilty pleasure check)
    (f.rating ?? 3) < 2.5 &&              // Rated below 2.5 (neutral=3 default doesn't count)
    f.rating != null &&                    // Must have an actual rating
    params.mappings.get(f.uri)
  );
  const dislikedIdsAll = watchedNotLiked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];

  // Add negative feedback IDs to disliked list to penalize their features
  dislikedIdsAll.push(...Array.from(negativeFeedbackIds));

  // Add positive feedback IDs to liked list to boost their features
  likedIdsAll.push(...Array.from(positiveFeedbackIds));

  // Build per-source reliability from user feedback (Laplace-smoothed hit rate)
  const buildSourceReliability = () => {
    if (!params.sourceMetadata || params.sourceMetadata.size === 0) return null;

    const stats = new Map<string, { pos: number; neg: number }>();

    for (const [tmdbId, type] of feedbackMap.entries()) {
      const meta = params.sourceMetadata.get(tmdbId);
      if (!meta) continue;
      const keyType = type === 'positive' ? 'pos' : type === 'negative' ? 'neg' : null;
      if (!keyType) continue;
      for (const src of meta.sources || []) {
        const key = src.toLowerCase();
        const curr = stats.get(key) ?? { pos: 0, neg: 0 };
        curr[keyType] += 1;
        stats.set(key, curr);
      }
    }

    if (stats.size === 0) return null;

    const reliability = new Map<string, number>();
    for (const [src, { pos, neg }] of stats.entries()) {
      const rate = (pos + 1) / (pos + neg + 2); // Laplace smoothing
      // Map rate to multiplier in ~0.9–1.12 range (centered at 1.0)
      const multiplier = Math.min(1.12, Math.max(0.9, 1 + (rate - 0.5) * 0.4));
      reliability.set(src, multiplier);
    }

    return reliability;
  };

  const userSourceReliability = params.sourceReliability ?? buildSourceReliability();

  // Fetch user's reason type preferences for adaptive weighting
  // This learns which recommendation reasons (genre, director, actor, etc.) lead to positive feedback
  const reasonPreferences = await getReasonPreferences(params.userId);
  console.log('[AdaptiveLearning] Loaded reason preferences', {
    count: reasonPreferences.size,
    preferences: Array.from(reasonPreferences.entries()).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
  });

  // Filter out candidates that have negative feedback
  // We need to modify the candidates array that will be used for scoring
  // Since params.candidates is passed by value (reference to array), we can just use a local filtered version
  // But wait, suggestByOverlap uses params.candidates later?
  // Let's check the rest of the file.
  // Actually, we should probably filter it right here.
  // Soft-avoid: keep negatively-rated candidates but apply a strong penalty later.
  // Hard blocks are handled upstream via blocked_suggestions.
  const validCandidates = params.candidates.slice();

  // Use validCandidates instead of params.candidates in the rest of the function
  // We need to make sure we replace usages of params.candidates with validCandidates
  // Or we can just reassign params.candidates if it wasn't const (it is in the function signature object)
  // So we'll define a new variable and use it.

  // Precompute watchlist intent metadata for quick lookup during scoring
  const watchlistIntentMap = new Map<number, { boost: number; label: string; ageText: string }>();
  if (params.watchlistEntries && params.watchlistEntries.length > 0) {
    const now = Date.now();

    const computeRecency = (addedAt?: string | null) => {
      if (!addedAt) {
        return { boost: 0.6, label: 'saved in your watchlist', ageText: 'saved previously' };
      }

      const days = Math.max(1, Math.round((now - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24)));

      if (days <= 30) return { boost: 1.2, label: 'recently added', ageText: `${days}d ago` };
      if (days <= 90) return { boost: 1.0, label: 'added this quarter', ageText: `${days}d ago` };
      if (days <= 180) return { boost: 0.8, label: 'added this year', ageText: `${days}d ago` };
      return { boost: 0.55, label: 'long-term watch', ageText: `${days}d ago` };
    };

    for (const entry of params.watchlistEntries) {
      const recency = computeRecency(entry.addedAt);
      const existing = watchlistIntentMap.get(entry.tmdbId);
      // Keep the strongest intent boost if duplicates occur
      if (!existing || recency.boost > existing.boost) {
        watchlistIntentMap.set(entry.tmdbId, recency);
      }
    }
  }

  // Exclude watchlist movies from main suggestions - they have their own dedicated section
  // ("Picks From Your Letterboxd Watchlist")
  const watchlistTmdbIds = new Set(params.watchlistEntries?.map(e => e.tmdbId) ?? []);
  const candidatesAfterWatchlistExclusion = validCandidates.filter(id => !watchlistTmdbIds.has(id));

  if (watchlistTmdbIds.size > 0) {
    console.log('[SuggestByOverlap] Excluded watchlist movies from main suggestions:', {
      watchlistCount: watchlistTmdbIds.size,
      originalCandidates: validCandidates.length,
      filteredCandidates: candidatesAfterWatchlistExclusion.length
    });
  }

  // Use filtered candidates for the rest of the function
  const finalCandidates = candidatesAfterWatchlistExclusion;

  const likedCap = 800;
  const dislikedCap = 400;
  // If the user has an enormous number of liked films, bias towards
  // the most recent ones (assuming input films are roughly chronological).
  const likedIds = likedIdsAll.length > likedCap ? likedIdsAll.slice(-likedCap) : likedIdsAll;
  const dislikedIds = dislikedIdsAll.length > dislikedCap ? dislikedIdsAll.slice(-dislikedCap) : dislikedIdsAll;


  // Create a map of film URI to its rating and liked status for weighted profile building
  const filmPreferenceMap = new Map<string, { rating?: number; liked?: boolean }>();
  for (const f of params.films) {
    filmPreferenceMap.set(f.uri, { rating: f.rating, liked: f.liked });
  }

  const likedMovies = await mapLimit(likedIds, 10, async (id) => {
    try {
      return await fetchTmdbMovieCached(id);
    } catch (e) {
      console.error(`[SuggestByOverlap] Failed to fetch liked movie ${id}`, e);
      return null;
    }
  });
  const dislikedMovies = await mapLimit(dislikedIds, 10, async (id) => {
    try {
      return await fetchTmdbMovieCached(id);
    } catch (e) {
      console.error(`[SuggestByOverlap] Failed to fetch disliked movie ${id}`, e);
      return null;
    }
  });

  const likedFeats = likedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));
  const dislikedFeats = dislikedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));

  // Map TMDB IDs back to original film data for weighting
  const likedFilmData = liked.filter(f => params.mappings.has(f.uri));

  // Multi-factor scoring weights (Phase 2 enhancements)
  // Total positive weights: 100% distributed across factors
  // Negative penalties applied separately
  const weights = {
    // Primary factors (70%)
    genre: 1.2,           // 30% - Genre matching (base weight, scaled by matches)
    genreCombo: 1.8,      // Bonus for exact genre combinations (subgenre specificity)
    director: 1.0,        // 20% - Director matching
    actor: 0.75,          // 15% - Actor matching (NEW)

    // Secondary factors (20%)
    keyword: 0.5,         // 10% - Keyword/subgenre matching
    studio: 0.5,          // 10% - Production company matching (NEW)

    // Tertiary factors (10%)
    cast: 0.2,            // 5% - Supporting cast matching
    crossGenre: 0.2,      // 5% - Cross-genre pattern bonus

    // Negative penalties (applied as deductions)
    avoidGenrePenalty: -2.0,    // Strong penalty for avoided genres
    avoidKeywordPenalty: -1.0,  // Moderate penalty for avoided keywords
    avoidDirectorPenalty: -3.0, // Very strong penalty for avoided directors
  };

  // Build positive feature bags (things the user likes)
  // Now with weighted scoring based on rating and liked status
  const pref = {
    genres: new Map<string, number>(),
    genreCombos: new Map<string, number>(),
    directors: new Map<string, number>(),
    cast: new Map<string, number>(),
    productionCompanies: new Map<string, number>(), // Track studio preferences
    keywords: new Map<string, number>(),
    // Track directors/actors within specific subgenres for better matching
    directorKeywords: new Map<string, Set<string>>(), // director -> keywords they work in
    castKeywords: new Map<string, Set<string>>(), // cast -> keywords they work in
    // Track recent watches for recency boost
    recentGenres: new Set<string>(),
    recentDirectors: new Set<string>(),
    recentCast: new Set<string>(),
    recentKeywords: new Set<string>(),
    recentStudios: new Set<string>(),
    watchlistGenres: new Set<string>(),
    watchlistKeywords: new Set<string>(),
    watchlistDirectors: new Set<string>(),
  };

  // Build negative feature bags (things the user avoids)
  const avoid = {
    keywords: new Map<string, number>(),
    genreCombos: new Map<string, number>(),
  };

  // Helper function to calculate preference weight for a film
  // Takes into account both rating and liked status
  const getPreferenceWeight = (rating?: number, isLiked?: boolean): number => {
    // Base cases:
    // - 5 stars + liked = 2.0 (strongest signal)
    // - 5 stars, not liked = 1.5 (strong rating but no explicit like)
    // - 4 stars + liked = 1.5
    // - 4 stars, not liked = 1.2
    // - 3 stars + liked = 1.0 (liked but mediocre rating - respect the like)
    // - 2 stars + liked = 0.7 (edge case: low rating but liked - nuanced preference)
    // - 1 star + liked = 0.5 (very rare edge case)

    const r = rating ?? 3; // Default to 3 if no rating
    let weight = 0.0;

    if (r >= 4.5) {
      weight = isLiked ? 2.0 : 1.5;
    } else if (r >= 3.5) {
      weight = isLiked ? 1.5 : 1.2;
    } else if (r >= 2.5) {
      weight = isLiked ? 1.0 : 0.3; // Mediocre rating: liked matters more
    } else if (r >= 1.5) {
      weight = isLiked ? 0.7 : 0.1; // Low rating but liked: nuanced taste
    } else {
      weight = isLiked ? 0.5 : 0.0; // Very low: only count if explicitly liked
    }

    return weight;
  };

  // Track patterns
  let totalLiked = likedFeats.length;
  let likedAnimationCount = 0;
  let likedFamilyCount = 0;
  let likedChildrensCount = 0;

  for (let i = 0; i < likedFeats.length; i++) {
    const f = likedFeats[i];
    const filmData = likedFilmData[i];
    const weight = getPreferenceWeight(filmData?.rating, filmData?.liked);

    // Weight all features by the preference strength
    for (const g of f.genres) pref.genres.set(g, (pref.genres.get(g) ?? 0) + weight);
    if (f.genreCombo) pref.genreCombos.set(f.genreCombo, (pref.genreCombos.get(f.genreCombo) ?? 0) + weight);

    for (const d of f.directors) {
      pref.directors.set(d, (pref.directors.get(d) ?? 0) + weight);
      // Track which keywords/subgenres this director works in
      if (!pref.directorKeywords.has(d)) pref.directorKeywords.set(d, new Set());
      f.keywords.forEach(k => pref.directorKeywords.get(d)!.add(k));
    }

    for (const c of f.cast) {
      pref.cast.set(c, (pref.cast.get(c) ?? 0) + weight);
      // Track which keywords/subgenres this cast member works in
      if (!pref.castKeywords.has(c)) pref.castKeywords.set(c, new Set());
      f.keywords.forEach(k => pref.castKeywords.get(c)!.add(k));
    }

    // Track production companies/studios
    for (const studio of f.productionCompanies) {
      pref.productionCompanies.set(studio, (pref.productionCompanies.get(studio) ?? 0) + weight);
    }

    for (const k of f.keywords) pref.keywords.set(k, (pref.keywords.get(k) ?? 0) + weight);

    if (f.isAnimation) likedAnimationCount++;
    if (f.isFamily) likedFamilyCount++;
    if (f.isChildrens) likedChildrensCount++;
  }

  // Build lookup maps: track which films contribute to each feature
  // This allows us to show users which specific films triggered each recommendation
  const filmLookup = {
    genres: new Map<string, Array<{ id: number; title: string }>>(),
    directors: new Map<string, Array<{ id: number; title: string }>>(),
    cast: new Map<string, Array<{ id: number; title: string }>>(),
    keywords: new Map<string, Array<{ id: number; title: string }>>(),
    studios: new Map<string, Array<{ id: number; title: string }>>(),
  };

  // Build film lookup from liked films (limit to top films by weight for each feature)
  for (let i = 0; i < likedFeats.length; i++) {
    const f = likedFeats[i];
    const filmData = likedFilmData[i];
    const movie = likedMovies[i];
    const weight = getPreferenceWeight(filmData?.rating, filmData?.liked);

    // Only track films with meaningful weight (>= 1.0)
    if (weight < 1.0 || !movie) continue;

    const filmInfo = { id: likedIds[i], title: movie.title || `Film #${likedIds[i]}` };

    // Track genres
    for (const g of f.genres) {
      if (!filmLookup.genres.has(g)) filmLookup.genres.set(g, []);
      const list = filmLookup.genres.get(g)!;
      if (list.length < 20) list.push(filmInfo); // Cap at 20 per feature
    }

    // Track directors
    for (const d of f.directors) {
      if (!filmLookup.directors.has(d)) filmLookup.directors.set(d, []);
      const list = filmLookup.directors.get(d)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track cast
    for (const c of f.cast) {
      if (!filmLookup.cast.has(c)) filmLookup.cast.set(c, []);
      const list = filmLookup.cast.get(c)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track keywords
    for (const k of f.keywords) {
      if (!filmLookup.keywords.has(k)) filmLookup.keywords.set(k, []);
      const list = filmLookup.keywords.get(k)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track studios
    for (const studio of f.productionCompanies) {
      if (!filmLookup.studios.has(studio)) filmLookup.studios.set(studio, []);
      const list = filmLookup.studios.get(studio)!;
      if (list.length < 20) list.push(filmInfo);
    }
  }

  // Track recent watches (last 20 liked films) for recency boost
  const recentLiked = likedFeats.slice(-20);
  for (const f of recentLiked) {
    f.genres.forEach(g => pref.recentGenres.add(g));
    f.directors.forEach(d => pref.recentDirectors.add(d));
    f.cast.forEach(c => pref.recentCast.add(c));
    f.keywords.forEach(k => pref.recentKeywords.add(k));
    f.productionCompanies.forEach(s => pref.recentStudios.add(s));
  }

  // Build avoidance patterns from disliked films
  for (const f of dislikedFeats) {
    if (f.genreCombo) avoid.genreCombos.set(f.genreCombo, (avoid.genreCombos.get(f.genreCombo) ?? 0) + 1);
    for (const k of f.keywords) avoid.keywords.set(k, (avoid.keywords.get(k) ?? 0) + 1);
  }

  // Detect if user avoids animation/family/children's content
  // If less than 10% of liked films are in these categories, consider them avoided
  const animationThreshold = 0.1;
  const avoidsAnimation = totalLiked > 10 && (likedAnimationCount / totalLiked) < animationThreshold;
  const avoidsFamily = totalLiked > 10 && (likedFamilyCount / totalLiked) < animationThreshold;
  const avoidsChildrens = totalLiked > 10 && (likedChildrensCount / totalLiked) < animationThreshold;

  console.log('[Suggest] User profile analysis', {
    totalLiked,
    likedAnimationCount,
    likedFamilyCount,
    likedChildrensCount,
    avoidsAnimation,
    avoidsFamily,
    avoidsChildrens,
    topKeywords: Array.from(pref.keywords.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v.toFixed(1)})`),
    topGenreCombos: Array.from(pref.genreCombos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v.toFixed(1)})`),
    topDirectors: Array.from(pref.directors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, v]) => `${d}(${v.toFixed(1)})`),
    topCast: Array.from(pref.cast.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `${c}(${v.toFixed(1)})`),
  });

  // Build advanced subgenre patterns for nuanced filtering
  // E.g., "likes Action but avoids Superhero Action"
  // Fetch TMDB data for all mapped films (with reasonable cap to avoid huge fan-out)
  const mappedFilmsForAnalysis = params.films
    .filter(f => params.mappings.get(f.uri))
    .slice(-400); // Cap at 400 most recent to avoid excessive fetches

  const mappedIds = mappedFilmsForAnalysis.map(f => params.mappings.get(f.uri)!);
  const moviesForAnalysis = await mapLimit(mappedIds, 10, async (id) => {
    try {
      return await fetchTmdbMovieCached(id);
    } catch (e) {
      console.error(`[SuggestByOverlap] Analysis fetch failed for ${id}`, e);
      return null;
    }
  });

  const filmsForSubgenreAnalysis = mappedFilmsForAnalysis.map((f, idx) => {
    const cached = moviesForAnalysis[idx];
    return {
      title: f.title,
      genres: cached?.genres?.map(g => g.name) || [],
      keywords: (cached as any)?.keywords?.keywords?.map((k: any) => k.name) ||
        (cached as any)?.keywords?.results?.map((k: any) => k.name) || [],
      rating: f.rating,
      liked: f.liked
    };
  });

  const subgenrePatterns = analyzeSubgenrePatterns(filmsForSubgenreAnalysis);
  const crossGenrePatterns = analyzeCrossGenrePatterns(filmsForSubgenreAnalysis);

  console.log('[Suggest] Subgenre analysis complete', {
    patternsDetected: subgenrePatterns.size,
    crossPatternsDetected: crossGenrePatterns.size,
    exampleAvoidances: Array.from(subgenrePatterns.entries())
      .filter(([_, p]) => p.avoidedSubgenres.size > 0)
      .slice(0, 3)
      .map(([genre, p]) => `${genre}: avoids ${Array.from(p.avoidedSubgenres).slice(0, 2).join(', ')}`)
  });

  const seenIds = new Set(likedIds);
  // Also treat already-watched mapped films as seen to avoid recommending
  for (const f of params.films) {
    const id = params.mappings.get(f.uri);
    if (id) seenIds.add(id);
  }
  if (params.excludeWatchedIds) {
    for (const id of params.excludeWatchedIds) seenIds.add(id);
  }

  // Pre-process adjacent genres for fast lookup
  // We want to boost genres that are "adjacent" to the user's recent watches
  const adjacentBoosts = new Map<string, number>();
  if (params.enhancedProfile?.adjacentGenres && params.enhancedProfile?.recentGenres) {
    // For each recent genre, find its adjacent targets
    for (const recent of params.enhancedProfile.recentGenres) {
      const targets = params.enhancedProfile.adjacentGenres.get(recent);
      if (targets) {
        for (const t of targets) {
          // Accumulate boosts (max 2.0)
          const current = adjacentBoosts.get(t.genre) || 0;
          adjacentBoosts.set(t.genre, Math.min(2.0, current + (t.weight * 0.5)));
        }
      }
    }
  }

  // Watchlist intent feature sets (names) for reason text
  const watchlistGenreSet = new Set(params.enhancedProfile?.watchlistGenres ?? []);
  const watchlistKeywordSet = new Set(params.enhancedProfile?.watchlistKeywords ?? []);
  const watchlistDirectorSet = new Set(params.enhancedProfile?.watchlistDirectors ?? []);

  const maxC = Math.min(params.maxCandidates ?? 120, finalCandidates.length);
  const desired = Math.max(10, Math.min(500, params.desiredResults ?? 50)); // Increased max from 30 to 500 to support 24 sections

  // Helper to fetch from cache first in bulk where possible
  async function fetchFromCache(id: number): Promise<TMDBMovie | null> {
    return await fetchTmdbMovieCached(id);
  }

  const resultsAcc: Array<{ tmdbId: number; score: number; reasons: string[]; title?: string; release_date?: string; genres?: string[]; poster_path?: string | null; contributingFilms?: Record<string, Array<{ id: number; title: string }>> }> = [];
  const pool = await mapLimit(finalCandidates.slice(0, maxC), params.concurrency ?? 8, async (cid) => {
    if (seenIds.has(cid)) return null; // skip already-liked
    const m = await fetchFromCache(cid);
    if (!m) return null;
    const feats = extractFeatures(m);

    // Source metadata for consensus-aware quality gating
    const sourceMetaQuality = params.sourceMetadata?.get(cid);
    const sourceCount = sourceMetaQuality?.sources?.length ?? 0;
    const consensusLevel = sourceMetaQuality?.consensusLevel;
    const strongConsensus = consensusLevel === 'high' || sourceCount >= 2;

    // Exclude by genres early if requested
    if (params.excludeGenres && feats.genres.some((g) => params.excludeGenres!.has(g.toLowerCase()))) {
      return null;
    }

    // QUALITY FILTER: Exclude low-quality movies
    // Filter out "B" movies and low-rated content to ensure quality suggestions
    const minVoteAverage = 6.0;  // Minimum rating of 6.0/10
    const minVoteCount = 50;      // Minimum 50 votes for statistical relevance

    if (feats.voteAverage < minVoteAverage || feats.voteCount < minVoteCount) {
      return null; // Skip low-quality or unrated movies
    }

    // Apply negative filters: exclude animation/family/children's if user avoids them
    if (avoidsAnimation && feats.isAnimation) return null;
    if (avoidsFamily && feats.isFamily) return null;
    if (avoidsChildrens && feats.isChildrens) return null;

    // Check if genre combo is in avoided patterns (appears more in disliked than liked)
    if (feats.genreCombo && avoid.genreCombos.has(feats.genreCombo)) {
      const avoidCount = avoid.genreCombos.get(feats.genreCombo) ?? 0;
      const likeCount = pref.genreCombos.get(feats.genreCombo) ?? 0;
      if (avoidCount > likeCount * 2) return null; // Skip if strongly avoided
    }

    // Check for avoided keywords (appear more in disliked than liked)
    const strongAvoidedKeywords = feats.keywords.filter(k => {
      const avoidCount = avoid.keywords.get(k) ?? 0;
      const likeCount = pref.keywords.get(k) ?? 0;
      return avoidCount > 2 && avoidCount > likeCount * 2;
    });
    if (strongAvoidedKeywords.length > 2) return null; // Skip if multiple strong avoid signals

    // ADVANCED FILTERING: Apply subgenre-level filtering
    // E.g., filter "Superhero Action" if user avoids that subgenre within Action
    const subgenreCheck = shouldFilterBySubgenre(
      feats.genres,
      feats.keywords,
      feats.keywordIds, // Added keywordIds
      m.title || '',
      subgenrePatterns
    );

    if (subgenreCheck.shouldFilter) {
      console.log(`[SubgenreFilter] Filtered "${m.title}" - ${subgenreCheck.reason}`);
      return null;
    }

    // Check niche compatibility (anime, stand-up, food/travel docs)
    const nicheProfile = {
      nichePreferences: {
        likesAnime: (likedAnimationCount / totalLiked) >= 0.1,
        likesStandUp: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('stand-up') || k.toLowerCase().includes('stand up')),
        likesFoodDocs: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('food') || k.toLowerCase().includes('cooking')),
        likesTravelDocs: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('travel') || k.toLowerCase().includes('journey'))
      }
    };

    const nicheCheck = checkNicheCompatibility(m, nicheProfile as any);
    if (!nicheCheck.compatible) {
      console.log(`[NicheFilter] Filtered "${m.title}" - ${nicheCheck.reason}`);
      return null;
    }

    let score = 0;
    const reasons: string[] = [];

    /**
     * Compute metadata completeness as a normalized 0-1 score
     * Weight components by importance for user decision-making:
     * - Poster: 30% (essential for browsing)
     * - Overview: 25% (needed for informed decision)
     * - Votes: 20% (confidence in rating)
     * - Backdrop: 15% (visual appeal)
     * - Trailer: 10% (nice to have)
     */
    const computeMetadataCompleteness = (): number => {
      const weights = {
        poster: 0.30,
        overview: 0.25,
        votes: 0.20,
        backdrop: 0.15,
        trailer: 0.10,
      };

      const hasPosterLocal = Boolean(m.poster_path || (m as any).omdb_poster);
      const hasBackdropLocal = Boolean(m.backdrop_path);
      const hasOverviewLocal = Boolean(m.overview && m.overview.trim().length > 20);
      const hasTrailerLocal = Boolean((m as any).videos?.results?.some((v: any) =>
        v.site === 'YouTube' && v.type === 'Trailer'
      ));
      const hasVotesLocal = Boolean((m as any).vote_count && (m as any).vote_count >= 50);

      return (
        (hasPosterLocal ? weights.poster : 0) +
        (hasOverviewLocal ? weights.overview : 0) +
        (hasVotesLocal ? weights.votes : 0) +
        (hasBackdropLocal ? weights.backdrop : 0) +
        (hasTrailerLocal ? weights.trailer : 0)
      );
    };

    const metadataCompleteness = computeMetadataCompleteness();

    // Soft avoid: previously dismissed items get a strong penalty but are not fully removed
    if (negativeFeedbackIds.has(cid)) {
      score -= 4.0;
      reasons.push('Previously dismissed — softened (undo via unblock if needed)');
    }

    // QUALITY GATES: downrank items with missing metadata unless strong consensus
    const hasPoster = Boolean(m.poster_path || (m as any).omdb_poster);
    const hasBackdrop = Boolean(m.backdrop_path);
    const hasOverview = Boolean(m.overview && m.overview.trim().length > 0);
    const hasTrailer = Boolean((m as any).videos?.results?.some((v: any) => v.site === 'YouTube' && v.type === 'Trailer'));

    let qualityPenalty = 0;
    const qualityNotes: string[] = [];

    if (!hasPoster) {
      qualityPenalty -= strongConsensus ? 0.2 : 0.6;
      qualityNotes.push('poster missing');
    }
    if (!hasBackdrop) {
      qualityPenalty -= strongConsensus ? 0.1 : 0.3;
    }
    if (!hasOverview) {
      qualityPenalty -= strongConsensus ? 0.15 : 0.4;
      qualityNotes.push('synopsis missing');
    }
    if (!hasTrailer) {
      qualityPenalty -= strongConsensus ? 0.1 : 0.25;
    }

    if (qualityPenalty < 0) {
      qualityPenalty = Math.max(qualityPenalty, -1.5);
      score += qualityPenalty;
      if (qualityNotes.length) {
        const note = qualityNotes.join(', ');
        if (strongConsensus) {
          reasons.push(`Strong consensus despite limited metadata (${note})`);
        } else {
          reasons.push(`Limited metadata (${note}) — confidence slightly reduced`);
        }
      } else if (!strongConsensus) {
        reasons.push('Limited metadata — confidence slightly reduced');
      }
    }

    // Context-aware biases: adjust score and occasionally filter based on session mode
    const contextBias = applyContextBias(feats, m);
    if (contextBias.filtered) return null;
    if (contextBias.delta !== 0) {
      score += contextBias.delta;
    }
    if (contextBias.reasons.length) {
      reasons.push(...contextBias.reasons);
    }

    // WATCHLIST INTENT: prioritize movies the user explicitly saved (recency-weighted)
    const watchlistIntent = watchlistIntentMap.get(cid);
    if (watchlistIntent) {
      score += watchlistIntent.boost;
      const when = watchlistIntent.ageText ? `, added ${watchlistIntent.ageText}` : '';
      reasons.push(`On your Letterboxd watchlist (${watchlistIntent.label}${when}) — honoring your intent`);
    }

    // CROSS-GENRE BOOST: Check if candidate matches user's preferred genre combinations
    // E.g., boost "Action+Thriller with spy themes" if user loves that pattern
    const crossGenreBoost = boostForCrossGenreMatch(
      feats.genres,
      feats.keywords,
      crossGenrePatterns
    );

    if (crossGenreBoost.boost > 0) {
      // Cap cross-genre boost at 3.0 to prevent over-stacking
      const cappedCrossGenreBoost = Math.min(crossGenreBoost.boost, 3.0);
      score += cappedCrossGenreBoost;
      if (crossGenreBoost.reason) {
        reasons.push(crossGenreBoost.reason);
        console.log(`[CrossGenreBoost] Boosted "${m.title}" by ${cappedCrossGenreBoost.toFixed(2)} - ${crossGenreBoost.reason}`);
      }
    }

    // ADAPTIVE LEARNING BOOST: Check if matches learned genre transitions
    // E.g. User watched Drama recently -> Boost Sci-Fi if that's a learned transition
    if (adjacentBoosts.size > 0) {
      let maxAdjBoost = 0;
      let boostedGenre = '';

      for (const g of feats.genres) {
        const boost = adjacentBoosts.get(g);
        if (boost && boost > maxAdjBoost) {
          maxAdjBoost = boost;
          boostedGenre = g;
        }
      }

      if (maxAdjBoost > 0) {
        // Prevent double boosting: If user already loves this genre (high weight), 
        // the transition boost is redundant or should be minimal.
        const existingWeight = pref.genres.get(boostedGenre) || 0;

        if (existingWeight > 5.0) {
          // User already strongly loves this genre, no need for transition boost
          maxAdjBoost = 0;
        } else if (existingWeight > 2.0) {
          // User likes this genre, reduce transition boost
          maxAdjBoost *= 0.5;
        }

        if (maxAdjBoost > 0) {
          score += maxAdjBoost;
          reasons.push(`Matches your learned preference for ${boostedGenre} after recent watches`);
        }
      }
    }

    // Genre combo matching (more specific than individual genres)
    if (feats.genreCombo && pref.genreCombos.has(feats.genreCombo)) {
      const comboWeight = pref.genreCombos.get(feats.genreCombo) ?? 1;
      score += comboWeight * weights.genreCombo;
      const comboCountRounded = Math.round(comboWeight);
      const strength = reasonStrengthLabel(comboWeight);
      reasons.push(`Matches your specific taste in ${feats.genres.join(' + ')} films (${comboCountRounded} highly-rated similar ${comboCountRounded === 1 ? 'film' : 'films'}) — ${strength} signal`);
    } else {
      // Fallback to individual genre matching if combo doesn't match
      const gHits = feats.genres.filter((g) => pref.genres.has(g));
      if (gHits.length) {
        const totalGenreWeight = gHits.reduce((sum, g) => sum + (pref.genres.get(g) ?? 0), 0);
        score += totalGenreWeight * weights.genre;
        const genreWeight = pref.genres.get(gHits[0]) ?? 1;
        const genreCountRounded = Math.round(genreWeight);
        const strength = reasonStrengthLabel(genreWeight);
        reasons.push(`Matches your taste in ${gHits.slice(0, 3).join(', ')} (${genreCountRounded} similar ${genreCountRounded === 1 ? 'film' : 'films'}) — ${strength} signal`);

        // Watchlist intent reason if genre aligns with user's watchlist
        const watchlistGenreHits = gHits.filter(g => watchlistGenreSet.has(g));
        if (watchlistGenreHits.length > 0) {
          reasons.push(`On your watchlist: ${watchlistGenreHits.slice(0, 2).join(', ')}`);
        }
      }
    }

    const dHits = feats.directors.filter((d) => pref.directors.has(d));
    if (dHits.length) {
      const totalDirWeight = dHits.reduce((sum, d) => sum + (pref.directors.get(d) ?? 0), 0);
      score += totalDirWeight * weights.director;
      const dirWeight = pref.directors.get(dHits[0]) ?? 1;
      const dirCountRounded = Math.round(dirWeight);
      const dirQuality = dirWeight >= 3.0 ? 'highly rated' : 'enjoyed';
      const strength = reasonStrengthLabel(dirWeight);
      reasons.push(`Directed by ${dHits.slice(0, 2).join(', ')} — you've ${dirQuality} ${dirCountRounded} ${dirCountRounded === 1 ? 'film' : 'films'} by ${dHits.length === 1 ? 'this director' : 'these directors'} — ${strength} signal`);

      if (dHits.some(d => watchlistDirectorSet.has(d))) {
        reasons.push('On your watchlist: director interest');
      }
    } else {
      // Check for similar directors (directors who work in the same subgenres/keywords)
      const similarDirectors: Array<{ director: string; likedDirector: string; sharedThemes: string[] }> = [];

      for (const candidateDir of feats.directors) {
        const candidateKeywords = new Set(feats.keywords);

        // Check each director the user likes
        for (const [likedDir, dirKeywords] of pref.directorKeywords.entries()) {
          const sharedKeywords = Array.from(dirKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2) {
            similarDirectors.push({
              director: candidateDir,
              likedDirector: likedDir,
              sharedThemes: sharedKeywords.slice(0, 3)
            });
            break; // Only match once per candidate director
          }
        }
      }

      if (similarDirectors.length) {
        const firstMatch = similarDirectors[0];
        const likedWeight = pref.directors.get(firstMatch.likedDirector) ?? 0.8;
        const similarity = Math.min(1, firstMatch.sharedThemes.length / 4); // cap similarity
        let borrow = likedWeight * 0.25 * similarity; // borrow a fraction of strong signal
        borrow = Math.min(0.6, borrow); // hard cap to keep gentle
        // Light decay so borrowed signals fade if not reinforced elsewhere
        borrow *= 0.9;

        score += borrow * weights.director;
        reasons.push(`Similar to ${firstMatch.likedDirector} you love — shares themes like ${firstMatch.sharedThemes.slice(0, 2).join(', ')} (borrowed confidence)`);
      }
    }

    const cHits = feats.cast.filter((c) => pref.cast.has(c));
    if (cHits.length) {
      const totalCastWeight = cHits.slice(0, 3).reduce((sum, c) => sum + (pref.cast.get(c) ?? 0), 0);
      score += totalCastWeight * weights.cast;
      const topCastWeight = Math.max(...cHits.map(c => pref.cast.get(c) ?? 0));
      const castCountRounded = Math.round(topCastWeight);
      const strength = reasonStrengthLabel(topCastWeight);
      reasons.push(`Stars ${cHits.slice(0, 3).join(', ')} — ${cHits.length} cast ${cHits.length === 1 ? 'member' : 'members'} you've liked before — ${strength} signal`);
    } else {
      // Check for similar actors (actors who work in the same subgenres)
      const similarCast: Array<{ actor: string; likedActor: string; sharedThemes: string[] }> = [];

      for (const candidateActor of feats.cast) {
        const candidateKeywords = new Set(feats.keywords);

        // Check each actor the user likes
        for (const [likedActor, actorKeywords] of pref.castKeywords.entries()) {
          const sharedKeywords = Array.from(actorKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2) {
            similarCast.push({
              actor: candidateActor,
              likedActor: likedActor,
              sharedThemes: sharedKeywords.slice(0, 3)
            });
            break; // Only match once per candidate actor
          }
        }
      }

      if (similarCast.length) {
        const firstMatch = similarCast[0];
        const likedWeight = pref.cast.get(firstMatch.likedActor) ?? 0.6;
        const similarity = Math.min(1, firstMatch.sharedThemes.length / 4);
        let borrow = likedWeight * 0.2 * similarity; // gentle borrow
        borrow = Math.min(0.4, borrow);
        borrow *= 0.9; // decay borrowed signal so it needs reinforcement

        score += borrow * weights.cast;
        reasons.push(`Similar to ${firstMatch.likedActor} you enjoy — works in ${firstMatch.sharedThemes.slice(0, 2).join(', ')} themes (borrowed confidence)`);
      }
    }

    // Keyword matching - now more important for subgenre detection
    const kHits = feats.keywords.filter((k) => pref.keywords.has(k));
    if (kHits.length) {
      // Sort keywords by weighted frequency in user's liked films
      const sortedKHits = kHits
        .map(k => ({ keyword: k, weight: pref.keywords.get(k) ?? 0 }))
        .sort((a, b) => b.weight - a.weight);

      const topKeywords = sortedKHits.slice(0, 5);
      const totalKeywordWeight = topKeywords.reduce((sum, k) => sum + k.weight, 0);
      const keywordScore = topKeywords.reduce((sum, k) => sum + Math.log(k.weight + 1), 0);
      score += keywordScore * weights.keyword;

      const topKeywordNames = topKeywords.slice(0, 3).map(k => k.keyword);
      const topKeywordWeight = topKeywords[0]?.weight ?? 1;
      const isStrongPattern = topKeywordWeight >= 3.0;
      const strengthText = isStrongPattern ? 'especially love' : 'enjoy';
      const countRounded = Math.round(topKeywordWeight);
      const strengthLabel = reasonStrengthLabel(topKeywordWeight);
      reasons.push(`Matches specific themes you ${strengthText}: ${topKeywordNames.join(', ')} (${countRounded}+ highly-rated films) — ${strengthLabel} signal`);

      if (kHits.some(k => watchlistKeywordSet.has(k))) {
        reasons.push('On your watchlist: themes you saved');
      }
    }

    // Studio/Production company matching
    // NOTE: Only use legacy matching when enhanced profile doesn't have studio data
    // This prevents double-counting studios (legacy + enhanced profile)
    const studioHits = feats.productionCompanies.filter(s => pref.productionCompanies.has(s));
    const hasEnhancedStudioData = params.enhancedProfile?.topStudios && params.enhancedProfile.topStudios.length > 0;

    if (studioHits.length && !hasEnhancedStudioData) {
      const totalStudioWeight = studioHits.reduce((sum, s) => sum + (pref.productionCompanies.get(s) ?? 0), 0);
      score += totalStudioWeight * weights.studio; // Use weights.studio for consistency
      const topStudio = studioHits[0];
      const studioWeight = pref.productionCompanies.get(topStudio) ?? 1;
      const studioCountRounded = Math.round(studioWeight);

      // Special callouts for notable indie/boutique studios
      const notableStudios = ['A24', 'Neon', 'Annapurna Pictures', 'Focus Features', 'Blumhouse Productions',
        'Studio Ghibli', 'Searchlight Pictures', 'IFC Films', 'Magnolia Pictures',
        'Miramax', '24 Frames', 'Plan B Entertainment', 'Legendary Pictures'];
      const isNotableStudio = notableStudios.some(n => topStudio.includes(n));

      if (isNotableStudio) {
        reasons.push(`From ${topStudio} — you've loved ${studioCountRounded} ${studioCountRounded === 1 ? 'film' : 'films'} from this studio`);
      } else {
        reasons.push(`From ${studioHits.slice(0, 2).join(', ')} — studios you enjoy`);
      }
    }

    // PHASE 2: Enhanced actor matching using taste profile
    if (params.enhancedProfile?.topActors) {
      const actorIds = new Set(m.credits?.cast?.map(c => c.id) || []);
      const matchedActors = params.enhancedProfile.topActors.filter(a => actorIds.has(a.id));

      if (matchedActors.length > 0) {
        // Weight by actor preference strength and billing position
        const actorScore = matchedActors.reduce((sum, actor) => {
          const castMember = m.credits?.cast?.find(c => c.id === actor.id);
          const billingBonus = castMember && castMember.order != null ? (1 / (castMember.order + 1)) : 0.5;
          return sum + (actor.weight * billingBonus);
        }, 0);

        score += actorScore * weights.actor;

        const topActor = matchedActors[0];
        const actorCount = matchedActors.length;
        if (actorCount === 1) {
          reasons.push(`Stars ${topActor.name} — one of your favorite actors`);
        } else {
          reasons.push(`Stars ${matchedActors.slice(0, 2).map(a => a.name).join(' and ')} — ${actorCount} actors you love`);
        }
      }
    }

    // PHASE 2: Enhanced studio matching using taste profile
    if (params.enhancedProfile?.topStudios) {
      const studioIds = new Set(feats.productionCompanyIds);
      const matchedStudios = params.enhancedProfile.topStudios.filter(s => studioIds.has(s.id));

      if (matchedStudios.length > 0) {
        const studioScore = matchedStudios.reduce((sum, studio) => sum + studio.weight, 0);
        score += studioScore * weights.studio;

        // Only add reason if not already added by legacy studio matching
        if (!studioHits.length) {
          const topStudio = matchedStudios[0];
          reasons.push(`From ${topStudio.name} — a studio whose films you consistently enjoy`);
        }
      }
    }

    // PHASE 2: Decade/era preference matching
    // Give a boost to films from the user's preferred eras
    if (params.enhancedProfile?.topDecades && m.release_date) {
      const year = parseInt(m.release_date.substring(0, 4));
      if (!isNaN(year)) {
        const movieDecade = Math.floor(year / 10) * 10;

        // Check if this decade matches user's preferred eras
        const matchedDecade = params.enhancedProfile.topDecades.find(d => d.decade === movieDecade);
        if (matchedDecade) {
          // Calculate boost based on decade preference weight (scaled down)
          const decadeBoost = Math.min(matchedDecade.weight * 0.3, 2.0); // Cap at 2.0
          score += decadeBoost;

          // Calculate what percentage of their collection is from this era
          const totalDecadeWeight = params.enhancedProfile.topDecades.reduce((sum, d) => sum + d.weight, 0);
          const decadePercent = Math.round((matchedDecade.weight / totalDecadeWeight) * 100);

          reasons.push(`From the ${movieDecade}s — matches your preference for this era (${decadePercent}% of your favorites)`);
          console.log(`[DecadeBoost] Boosted "${m.title}" (${year}) by ${decadeBoost.toFixed(2)} for ${movieDecade}s era preference`);
        }
      }
    }

    // PHASE 2: Negative signal penalties (avoid genres/keywords/directors)
    let totalPenalty = 0;
    const penaltyReasons: string[] = [];

    if (params.enhancedProfile?.avoidGenres) {
      const avoidedGenreIds = new Set(params.enhancedProfile.avoidGenres.map(g => g.id));
      const matchedAvoidGenres = feats.genreIds.filter(id => avoidedGenreIds.has(id));

      if (matchedAvoidGenres.length > 0) {
        const genrePenalty = matchedAvoidGenres.length * weights.avoidGenrePenalty;
        totalPenalty += genrePenalty;
        const avoidedGenre = params.enhancedProfile.avoidGenres.find(g => g.id === matchedAvoidGenres[0]);
        penaltyReasons.push(`Contains ${avoidedGenre?.name || 'genre'} you typically avoid`);
      }
    }

    if (params.enhancedProfile?.avoidKeywords) {
      const avoidedKeywordIds = new Set(params.enhancedProfile.avoidKeywords.map(k => k.id));
      const matchedAvoidKeywords = feats.keywordIds.filter(id => avoidedKeywordIds.has(id));

      if (matchedAvoidKeywords.length > 0) {
        const keywordPenalty = matchedAvoidKeywords.length * weights.avoidKeywordPenalty;
        totalPenalty += keywordPenalty;
        const avoidedKeyword = params.enhancedProfile.avoidKeywords.find(k => k.id === matchedAvoidKeywords[0]);
        penaltyReasons.push(`Has themes (${avoidedKeyword?.name || 'keyword'}) you dislike`);
      }
    }

    if (params.enhancedProfile?.avoidDirectors) {
      const avoidedDirectorIds = new Set(params.enhancedProfile.avoidDirectors.map(d => d.id));
      const matchedAvoidDirectors = feats.directorIds.filter(id => avoidedDirectorIds.has(id));

      if (matchedAvoidDirectors.length > 0) {
        const directorPenalty = matchedAvoidDirectors.length * weights.avoidDirectorPenalty;
        totalPenalty += directorPenalty;
        const avoidedDirector = params.enhancedProfile.avoidDirectors.find(d => d.id === matchedAvoidDirectors[0]);
        penaltyReasons.push(`Directed by ${avoidedDirector?.name || 'director'} whose films you don't enjoy`);
      }
    }

    // PHASE 3: Subgenre Detection & Filtering (NEW)
    // Detailed subgenre matching using TMDB Keyword IDs + Text
    if (subgenrePatterns && subgenrePatterns.size > 0) {
      const allText = `${m.title} ${m.overview || ''}`.toLowerCase();
      // Detect subgenres across all candidate genres
      const detectedSubgenres = new Set<string>();

      for (const g of feats.genres) {
        // Use both text and IDs for maximum accuracy
        const subs = detectSubgenres(g, allText, feats.keywords, feats.keywordIds);
        subs.forEach(s => detectedSubgenres.add(s));
      }

      // Check detected subgenres against profile
      for (const subgenre of detectedSubgenres) {
        // Check all patterns to see if there's an opinion on this subgenre
        for (const [parentGenre, pattern] of subgenrePatterns.entries()) {
          const subInfo = pattern.subgenres.get(subgenre);

          // 1. Boost for Preferred Subgenres
          if (pattern.preferredSubgenres.has(subgenre) || (subInfo && subInfo.weight > 2.0 && subInfo.liked > (subInfo.watched - subInfo.liked))) {
            // Boost based on weight, capped
            const weight = subInfo?.weight ?? 2.0;
            const boost = Math.min(weight * 0.8, 4.0);
            score += boost;

            const prettyName = subgenre.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase();
            const parentPretty = parentGenre.toLowerCase();
            reasons.push(`Matches your interest in ${prettyName} ${parentPretty} films`);
            console.log(`[SubgenreBoost] Boosted "${m.title}" by ${boost.toFixed(2)} for ${subgenre}`);

            // If we found a strong match, we can stop checking other patterns for THIS subgenre
            // (One boost covers it)
            break;
          }

          // 2. Penalty for Avoided Subgenres
          const dislikedCount = subInfo ? (subInfo.watched - subInfo.liked) : 0;
          if (pattern.avoidedSubgenres.has(subgenre) || (subInfo && subInfo.weight < -1.0 && dislikedCount > subInfo.liked)) {
            const weight = subInfo?.weight ?? -2.0;
            const penalty = Math.max(weight * 1.5, -8.0); // massive penalty for specific hatred
            totalPenalty += penalty;

            const prettyName = subgenre.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase();
            penaltyReasons.push(`Contains ${prettyName} elements match a subgenre you avoid`);
            console.log(`[SubgenrePenalty] Penalized "${m.title}" by ${penalty.toFixed(2)} for ${subgenre}`);
            break;
          }
        }
      }
    }

    // PANDORA-STYLE FEATURE FEEDBACK: Apply graduated penalties/boosts
    // Penalties grow with each rejection, starting from the FIRST interaction
    if (params.featureFeedback) {
      const ff = params.featureFeedback;
      const confidenceFromCount = (count: number) => {
        // Smoothly approaches 1.0; count 1 => ~0.5, count 3 => ~0.8, count 6+ => ~1.0
        return Math.min(1, Math.log1p(count) / Math.log(7));
      };

      const applySoftCap = (value: number, cap: number) => {
        if (value > 0) return Math.min(value, cap);
        return Math.max(value, -cap);
      };

      // Penalty for actors user has rejected (graduated based on rejection count)
      if (ff.avoidActors && ff.avoidActors.length > 0) {
        const avoidedActorMap = new Map(ff.avoidActors.map(a => [a.id, a]));
        const movieCastIds = (m.credits?.cast || []).slice(0, 5).map((c: any) => c.id);
        const matchedAvoidActors = movieCastIds
          .map((id: number) => avoidedActorMap.get(id))
          .filter((a): a is { id: number; name: string; weight: number; count: number } => a !== undefined);

        if (matchedAvoidActors.length > 0) {
          // Use the graduated weight from the feature, adjusted by position and confidence
          const leadActor = matchedAvoidActors.find(a => movieCastIds.indexOf(a.id) < 2);
          const supportingActors = matchedAvoidActors.filter(a => movieCastIds.indexOf(a.id) >= 2);

          let actorPenalty = 0;
          if (leadActor) {
            const confidence = confidenceFromCount(leadActor.count);
            const effectiveWeight = leadActor.weight * confidence;
            // Lead actor: full weight, confidence scaled; bump if repeated skips (hard avoid)
            const hardnessMultiplier = leadActor.count >= 3 ? 1.25 : 1;
            const leadPenalty = -applySoftCap(effectiveWeight * hardnessMultiplier, 4);
            actorPenalty += leadPenalty;
            const countLabel = leadActor.count === 1 ? 'once' : `${leadActor.count} times`;
            const hardnessLabel = leadActor.count >= 3 ? 'hard avoid' : 'soft avoid';
            penaltyReasons.push(`Stars ${leadActor.name} — ${hardnessLabel}; you've skipped their films ${countLabel}`);
          }
          for (const actor of supportingActors.slice(0, 2)) {
            const confidence = confidenceFromCount(actor.count);
            const effectiveWeight = actor.weight * confidence;
            // Supporting actors: 60% of graduated weight, confidence scaled
            actorPenalty -= applySoftCap(effectiveWeight * 0.6, 2.5);
          }

          totalPenalty += actorPenalty;
          console.log(`[PandoraLearning] Actor penalty for "${m.title}": ${matchedAvoidActors.map(a => `${a.name}(${a.count}👎)`).join(', ')} (${actorPenalty.toFixed(1)})`);
        }
      }

      // Penalty for keywords/themes user has rejected
      if (ff.avoidKeywords && ff.avoidKeywords.length > 0) {
        const avoidedKeywordMap = new Map(ff.avoidKeywords.map(k => [k.id, k]));
        const matchedKeywords = feats.keywordIds
          .map(id => avoidedKeywordMap.get(id))
          .filter((k): k is { id: number; name: string; weight: number; count: number } => k !== undefined);

        if (matchedKeywords.length > 0) {
          // Sum graduated weights with confidence scaling, cap to avoid over-penalizing
          const keywordPenalty = -applySoftCap(
            matchedKeywords.reduce((sum, k) => {
              const confidence = confidenceFromCount(k.count);
              return sum + (k.weight * confidence * 0.5);
            }, 0),
            4.0
          );
          totalPenalty += keywordPenalty;

          const topKeyword = matchedKeywords.sort((a, b) => b.weight - a.weight)[0];
          const countLabel = topKeyword.count === 1 ? 'before' : `${topKeyword.count} times`;
          const hardnessLabel = topKeyword.count >= 3 ? 'hard avoid' : 'soft avoid';
          penaltyReasons.push(`Contains "${topKeyword.name}" — ${hardnessLabel}; you've skipped this ${countLabel}`);
          console.log(`[PandoraLearning] Keyword penalty for "${m.title}": ${matchedKeywords.length} matches (${keywordPenalty.toFixed(1)})`);
        }
      }

      // Penalty for franchises (IMMEDIATE strong effect - even 1 rejection)
      if (ff.avoidFranchises && ff.avoidFranchises.length > 0 && feats.collection) {
        const avoidedFranchise = ff.avoidFranchises.find(f => f.id === feats.collection!.id);
        if (avoidedFranchise) {
          // Use the pre-calculated graduated weight for franchises (hard avoid from first skip)
          const confidence = confidenceFromCount(avoidedFranchise.count);
          const franchisePenalty = -applySoftCap(avoidedFranchise.weight * confidence * 1.2, 6);
          totalPenalty += franchisePenalty;
          const countLabel = avoidedFranchise.count === 1 ? '' : ` (${avoidedFranchise.count} skips)`;
          penaltyReasons.push(`Part of ${avoidedFranchise.name}${countLabel} — you seem done with this`);
          console.log(`[PandoraLearning] Franchise penalty for "${m.title}": ${avoidedFranchise.name} (${franchisePenalty.toFixed(1)})`);
        }
      }

      // BOOST for actors user has responded positively to (graduated)
      if (ff.preferActors && ff.preferActors.length > 0) {
        const preferredActorMap = new Map(ff.preferActors.map(a => [a.id, a]));
        const movieCastIds = (m.credits?.cast || []).slice(0, 5).map((c: any) => c.id);
        const matchedPreferActors = movieCastIds
          .map((id: number) => preferredActorMap.get(id))
          .filter((a): a is { id: number; name: string; weight: number; count: number } => a !== undefined);

        if (matchedPreferActors.length > 0) {
          const leadActor = matchedPreferActors.find(a => movieCastIds.indexOf(a.id) < 2);

          let actorBoost = 0;
          if (leadActor) {
            const confidence = confidenceFromCount(leadActor.count);
            actorBoost += applySoftCap(leadActor.weight * confidence, 3.5);
            const countLabel = leadActor.count === 1 ? '' : ` (${leadActor.count}× thumbs up)`;
            reasons.push(`Stars ${leadActor.name}${countLabel} — you love their work`);
          } else {
            const topActor = matchedPreferActors[0];
            const confidence = confidenceFromCount(topActor.count);
            actorBoost += applySoftCap(topActor.weight * confidence * 0.6, 2.0);
            reasons.push(`Features ${topActor.name} — you've enjoyed their films`);
          }

          score += actorBoost;
          console.log(`[PandoraLearning] Actor boost for "${m.title}": ${matchedPreferActors.map(a => a.name).join(', ')} (+${actorBoost.toFixed(1)})`);
        }
      }

      // BOOST for keywords/themes user responds positively to
      if (ff.preferKeywords && ff.preferKeywords.length > 0) {
        const preferredKeywordMap = new Map(ff.preferKeywords.map(k => [k.id, k]));
        const matchedKeywords = feats.keywordIds
          .map(id => preferredKeywordMap.get(id))
          .filter((k): k is { id: number; name: string; weight: number; count: number } => k !== undefined);

        if (matchedKeywords.length > 0) {
          // Sum graduated weights with confidence scaling, cap at 3.0 total
          const keywordBoost = applySoftCap(
            matchedKeywords.reduce((sum, k) => {
              const confidence = confidenceFromCount(k.count);
              return sum + (k.weight * confidence * 0.4);
            }, 0),
            3.0
          );
          score += keywordBoost;

          const topKeyword = matchedKeywords.sort((a, b) => b.weight - a.weight)[0];
          reasons.push(`Matches "${topKeyword.name}" — a theme you consistently enjoy`);
          console.log(`[PandoraLearning] Keyword boost for "${m.title}": ${matchedKeywords.length} matches (+${keywordBoost.toFixed(1)})`);
        }
      }

      // PENALTY for directors user has rejected (from pairwise learning)
      if (ff.avoidDirectors && ff.avoidDirectors.length > 0) {
        const avoidedDirectorMap = new Map(ff.avoidDirectors.map(d => [d.id, d]));
        const matchedAvoidDirectors = feats.directorIds
          .map(id => avoidedDirectorMap.get(id))
          .filter((d): d is { id: number; name: string; weight: number; count: number } => d !== undefined);

        if (matchedAvoidDirectors.length > 0) {
          const director = matchedAvoidDirectors[0];
          const confidence = confidenceFromCount(director.count);
          const directorPenalty = -applySoftCap(director.weight * confidence * 1.5, 4.0);
          totalPenalty += directorPenalty;
          const countLabel = director.count === 1 ? 'once' : `${director.count} times`;
          penaltyReasons.push(`Directed by ${director.name} — you've passed on their films ${countLabel}`);
          console.log(`[PandoraLearning] Director penalty for "${m.title}": ${director.name} (${directorPenalty.toFixed(1)})`);
        }
      }

      // BOOST for directors user prefers (from pairwise learning)
      if (ff.preferDirectors && ff.preferDirectors.length > 0) {
        const preferredDirectorMap = new Map(ff.preferDirectors.map(d => [d.id, d]));
        const matchedPreferDirectors = feats.directorIds
          .map(id => preferredDirectorMap.get(id))
          .filter((d): d is { id: number; name: string; weight: number; count: number } => d !== undefined);

        if (matchedPreferDirectors.length > 0) {
          const director = matchedPreferDirectors[0];
          const confidence = confidenceFromCount(director.count);
          const directorBoost = applySoftCap(director.weight * confidence * 1.5, 4.0);
          score += directorBoost;
          const countLabel = director.count === 1 ? '' : ` (${director.count}× chosen)`;
          reasons.push(`By ${director.name}${countLabel} — a director you consistently pick`);
          console.log(`[PandoraLearning] Director boost for "${m.title}": ${director.name} (+${directorBoost.toFixed(1)})`);
        }
      }

      // PENALTY for genres user has repeatedly rejected (from pairwise learning, requires 2+ net rejections)
      if (ff.avoidGenres && ff.avoidGenres.length > 0) {
        const avoidedGenreMap = new Map(ff.avoidGenres.map(g => [g.id, g]));
        const matchedAvoidGenres = feats.genreIds
          .map(id => avoidedGenreMap.get(id))
          .filter((g): g is { id: number; name: string; weight: number; count: number } => g !== undefined);

        if (matchedAvoidGenres.length > 0) {
          // Sum penalties but cap to avoid over-penalizing multi-genre films
          const genrePenalty = -applySoftCap(
            matchedAvoidGenres.reduce((sum, g) => {
              const confidence = confidenceFromCount(g.count);
              return sum + (g.weight * confidence * 0.5);
            }, 0),
            3.0
          );
          totalPenalty += genrePenalty;
          const topGenre = matchedAvoidGenres.sort((a, b) => b.weight - a.weight)[0];
          penaltyReasons.push(`Contains ${topGenre.name} — a genre you've been skipping`);
          console.log(`[PandoraLearning] Genre penalty for "${m.title}": ${matchedAvoidGenres.map(g => g.name).join(', ')} (${genrePenalty.toFixed(1)})`);
        }
      }

      // BOOST for genres user prefers (from pairwise learning, requires 2+ net approvals)
      if (ff.preferGenres && ff.preferGenres.length > 0) {
        const preferredGenreMap = new Map(ff.preferGenres.map(g => [g.id, g]));
        const matchedPreferGenres = feats.genreIds
          .map(id => preferredGenreMap.get(id))
          .filter((g): g is { id: number; name: string; weight: number; count: number } => g !== undefined);

        if (matchedPreferGenres.length > 0) {
          // Sum boosts but cap to prevent genre from dominating
          const genreBoost = applySoftCap(
            matchedPreferGenres.reduce((sum, g) => {
              const confidence = confidenceFromCount(g.count);
              return sum + (g.weight * confidence * 0.4);
            }, 0),
            2.5
          );
          score += genreBoost;
          const topGenre = matchedPreferGenres.sort((a, b) => b.weight - a.weight)[0];
          reasons.push(`Features ${topGenre.name} — a genre you consistently enjoy`);
          console.log(`[PandoraLearning] Genre boost for "${m.title}": ${matchedPreferGenres.map(g => g.name).join(', ')} (+${genreBoost.toFixed(1)})`);
        }
      }

      // PENALTY for subgenres user has rejected (from feedback learning)
      // Detect candidate movie's subgenres first
      const candidateAllText = (m.title || '').toLowerCase() + ' ' + (m.overview || '').toLowerCase();
      const candidateSubgenres = new Set<string>();
      for (const g of feats.genres) {
        const subs = detectSubgenres(g, candidateAllText, feats.keywords, feats.keywordIds);
        subs.forEach(s => candidateSubgenres.add(s));
      }

      if (ff.avoidSubgenres && ff.avoidSubgenres.length > 0 && candidateSubgenres.size > 0) {
        const matchedAvoidSubgenres = ff.avoidSubgenres.filter(s => candidateSubgenres.has(s.key));

        if (matchedAvoidSubgenres.length > 0) {
          const subgenrePenalty = -applySoftCap(
            matchedAvoidSubgenres.reduce((sum, s) => {
              const confidence = confidenceFromCount(s.count);
              return sum + (s.weight * confidence * 0.6); // Slightly stronger than keyword penalty
            }, 0),
            4.0
          );
          totalPenalty += subgenrePenalty;
          const topSubgenre = matchedAvoidSubgenres.sort((a, b) => b.weight - a.weight)[0];
          const prettyName = topSubgenre.key.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase();
          penaltyReasons.push(`Contains ${prettyName} — a specific style you've been avoiding`);
          console.log(`[PandoraLearning] Subgenre penalty for "${m.title}": ${matchedAvoidSubgenres.map(s => s.key).join(', ')} (${subgenrePenalty.toFixed(1)})`);
        }
      }

      // BOOST for subgenres user prefers (from feedback learning)
      if (ff.preferSubgenres && ff.preferSubgenres.length > 0 && candidateSubgenres.size > 0) {
        const matchedPreferSubgenres = ff.preferSubgenres.filter(s => candidateSubgenres.has(s.key));

        if (matchedPreferSubgenres.length > 0) {
          const subgenreBoost = applySoftCap(
            matchedPreferSubgenres.reduce((sum, s) => {
              const confidence = confidenceFromCount(s.count);
              return sum + (s.weight * confidence * 0.5);
            }, 0),
            3.0
          );
          score += subgenreBoost;
          const topSubgenre = matchedPreferSubgenres.sort((a, b) => b.weight - a.weight)[0];
          const prettyName = topSubgenre.key.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase();
          reasons.push(`Matches your taste in ${prettyName} — a style you consistently enjoy`);
          console.log(`[PandoraLearning] Subgenre boost for "${m.title}": ${matchedPreferSubgenres.map(s => s.key).join(', ')} (+${subgenreBoost.toFixed(1)})`);
        }
      }
    }

    // Apply penalties to score
    if (totalPenalty < 0) {
      score += totalPenalty; // totalPenalty is negative, so this reduces the score
      console.log(`[NegativePenalty] Penalized "${m.title}" by ${Math.abs(totalPenalty).toFixed(2)} - ${penaltyReasons.join('; ')}`);
    }

    // Recent watches boost - if matches genres/directors/cast/keywords from last 20 films
    let recentBoost = 0;
    const recentMatches: string[] = [];

    const recentGenreMatches = feats.genres.filter(g => pref.recentGenres.has(g));
    if (recentGenreMatches.length) {
      recentBoost += 0.5 * recentGenreMatches.length;
      recentMatches.push(`similar to recent ${recentGenreMatches.slice(0, 2).join('/')} films`);
    }

    const recentDirectorMatches = feats.directors.filter(d => pref.recentDirectors.has(d));
    if (recentDirectorMatches.length) {
      recentBoost += 1.0 * recentDirectorMatches.length;
      recentMatches.push(`from ${recentDirectorMatches[0]} you recently enjoyed`);
    }

    const recentCastMatches = feats.cast.filter(c => pref.recentCast.has(c)).slice(0, 2);
    if (recentCastMatches.length) {
      recentBoost += 0.3 * recentCastMatches.length;
      recentMatches.push(`stars ${recentCastMatches[0]} from recent watches`);
    }

    const recentKeywordMatches = feats.keywords.filter(k => pref.recentKeywords.has(k)).slice(0, 3);
    if (recentKeywordMatches.length >= 2) {
      recentBoost += 0.4 * recentKeywordMatches.length;
      recentMatches.push(`explores ${recentKeywordMatches.slice(0, 2).join('/')} themes from recent favorites`);
    }

    const recentStudioMatches = feats.productionCompanies.filter(s => pref.recentStudios.has(s));
    if (recentStudioMatches.length) {
      recentBoost += 0.6 * recentStudioMatches.length;
      recentMatches.push(`from ${recentStudioMatches[0]} you recently enjoyed`);
    }

    if (recentBoost > 0) {
      // Cap recent boost at 2.5 to prevent recency from over-dominating
      const cappedRecentBoost = Math.min(recentBoost, 2.5);
      score += cappedRecentBoost;
      reasons.push(`Based on recent watches: ${recentMatches.slice(0, 2).join('; ')}`);
    }

    // REMOVED: Seasonal boost no longer affects scoring to avoid limiting suggestions by time of year
    // Users should see movies from all seasons regardless of current date
    // Seasonal data remains visible on Stats page for informational purposes only
    // if (feats.hasSeasonalGenre) {
    //   const seasonalBoost = boostSeasonalGenres(score, feats.genreIds);
    //   if (seasonalBoost > score) {
    //     const boostAmount = seasonalBoost - score;
    //     score = seasonalBoost;
    //     const seasonalInfo = getCurrentSeasonalGenres();
    //     reasons.push(`Perfect for ${seasonalInfo.labels.join(' & ')} season`);
    //     console.log(`[SeasonalBoost] Boosted "${m.title}" by ${boostAmount.toFixed(2)} for seasonal relevance`);
    //   }
    // }

    // ADAPTIVE LEARNING: Apply reason type preference multipliers
    // This learns which recommendation reasons (genre, director, actor, etc.) work for this user
    if (reasonPreferences.size > 0) {
      // Extract which reason types contributed to this recommendation
      const reasonTypes = extractReasonTypes(reasons);

      if (reasonTypes.length > 0) {
        // Calculate average success rate for the reason types in this recommendation
        let totalWeight = 0;
        let weightedSuccessRate = 0;

        for (const rt of reasonTypes) {
          const successRate = reasonPreferences.get(rt);
          if (successRate !== undefined) {
            // Weight by how much we know about this type (success rate varies from 0 to 1)
            // Center at 0.5 (neutral), so below 0.5 reduces score, above 0.5 increases
            const modifier = (successRate - 0.5) * 2; // Ranges from -1 to +1
            totalWeight += 1;
            weightedSuccessRate += modifier;
          }
        }

        if (totalWeight > 0) {
          const avgModifier = weightedSuccessRate / totalWeight;
          // Apply as a mild multiplier (0.7 to 1.3 range) to avoid dramatic changes
          const multiplier = 1 + (avgModifier * 0.3);
          const oldScore = score;
          score = score * multiplier;

          if (Math.abs(multiplier - 1) > 0.05) {
            console.log(`[ReasonPreference] Adjusted "${m.title}" score: ${oldScore.toFixed(2)} -> ${score.toFixed(2)} (${multiplier.toFixed(2)}x) based on ${reasonTypes.join(', ')} preferences`);
          }
        }
      }
    }

    // Give base score to quality films even without direct taste matches
    // This allows hidden gems, crowd pleasers, and trending films to appear
    if (score <= 0) {
      // Award small base score for high-quality films (hidden gems, crowd pleasers, cult classics)
      if (feats.voteCategory === 'hidden-gem') {
        score = 0.3; // Hidden gems get small boost to ensure they appear
        reasons.push('Highly-rated hidden gem worth discovering');
      } else if (feats.voteCategory === 'crowd-pleaser') {
        score = 0.2; // Crowd pleasers get small boost
        reasons.push('Widely loved crowd-pleaser');
      } else if (feats.voteCategory === 'cult-classic') {
        score = 0.25; // Cult classics get small boost
        reasons.push('Cult classic with dedicated following');
      }
      // If still no score, filter out standard films with no taste matches
      if (score <= 0) return null;
    }

    // Build contributingFilms map for this suggestion
    // Map each matched feature to the user's films that have that feature
    const contributingFilms: Record<string, Array<{ id: number; title: string }>> = {};

    // Add films for matched genres
    const gHitsForLookup = feats.genres.filter((g) => pref.genres.has(g));
    for (const g of gHitsForLookup) {
      const films = filmLookup.genres.get(g) || [];
      if (films.length > 0) {
        contributingFilms[`genre:${g}`] = films.slice(0, 10); // Limit to 10 films per feature
      }
    }

    // Add films for matched directors
    const dHitsForLookup = feats.directors.filter((d) => pref.directors.has(d));
    for (const d of dHitsForLookup) {
      const films = filmLookup.directors.get(d) || [];
      if (films.length > 0) {
        contributingFilms[`director:${d}`] = films.slice(0, 10);
      }
    }

    // Add films for matched cast
    const cHitsForLookup = feats.cast.filter((c) => pref.cast.has(c));
    for (const c of cHitsForLookup) {
      const films = filmLookup.cast.get(c) || [];
      if (films.length > 0) {
        contributingFilms[`cast:${c}`] = films.slice(0, 10);
      }
    }

    // Add films for matched keywords
    const kHitsForLookup = feats.keywords.filter((k) => pref.keywords.has(k));
    for (const k of kHitsForLookup) {
      const films = filmLookup.keywords.get(k) || [];
      if (films.length > 0) {
        contributingFilms[`keyword:${k}`] = films.slice(0, 10);
      }
    }

    // Add films for matched studios
    const studioHitsForLookup = feats.productionCompanies.filter(s => pref.productionCompanies.has(s));
    for (const s of studioHitsForLookup) {
      const films = filmLookup.studios.get(s) || [];
      if (films.length > 0) {
        contributingFilms[`studio:${s}`] = films.slice(0, 10);
      }
    }

    // Get source metadata if available (for multi-source badge)
    const sourceMeta = params.sourceMetadata?.get(cid);
    let reliabilityMultiplier: number | undefined;

    // Adjust score by source reliability and consensus, capped to avoid dominating
    if (sourceMeta) {
      const defaultReliability = new Map<string, number>([
        ['tmdb', 1.0],
        ['trakt', 1.02],
        ['tastedive', 0.98],
        ['watchmode', 0.99],
        ['tuimdb', 0.98]
      ]);

      const reliabilityMap = userSourceReliability ?? defaultReliability;
      const sources = sourceMeta.sources || [];
      const avgReliability = sources.length
        ? sources.reduce((sum, s) => sum + (reliabilityMap.get(s.toLowerCase()) ?? 1), 0) / sources.length
        : 1;

      const consensusBoost = sourceMeta.consensusLevel === 'high' ? 1.05 : sourceMeta.consensusLevel === 'low' ? 0.97 : 1.0;
      const multiSourceBoost = sources.length > 1 ? 1 + Math.min((sources.length - 1) * 0.02, 0.06) : 1;
      reliabilityMultiplier = Math.min(1.12, Math.max(0.9, avgReliability * consensusBoost * multiSourceBoost));

      if (Math.abs(reliabilityMultiplier - 1) >= 0.02) {
        const oldScore = score;
        score = score * reliabilityMultiplier;
        const sourceLabel = sources.length ? `${sources.length} sources` : 'source consensus';
        reasons.push(`Backed by ${sourceMeta.consensusLevel || 'multi'} consensus across ${sourceLabel}`);
        console.log(`[SourceReliability] Adjusted "${m.title}" score: ${oldScore.toFixed(2)} -> ${score.toFixed(2)} (${reliabilityMultiplier.toFixed(2)}x)`);
      }
    }

    // REPEAT DECAY PENALTY: Penalize recently shown movies to favor fresh content
    // Movies shown recently get their scores reduced based on how recent the exposure was
    if (params.recentExposures) {
      const daysSince = params.recentExposures.get(cid);
      if (daysSince !== undefined) {
        let repeatPenalty = 1.0; // No penalty by default
        if (daysSince < 1) {
          // Shown today or yesterday: heavy penalty
          repeatPenalty = 0.60; // -40%
        } else if (daysSince < 3) {
          // Shown in last 3 days: moderate penalty
          repeatPenalty = 0.70; // -30%
        } else if (daysSince < 7) {
          // Shown in last week: light penalty
          repeatPenalty = 0.85; // -15%
        } else if (daysSince < 14) {
          // Shown in last 2 weeks: minimal penalty
          repeatPenalty = 0.95; // -5%
        }

        if (repeatPenalty < 1.0) {
          const oldScore = score;
          score = score * repeatPenalty;
          console.log(`[RepeatPenalty] "${m.title}" penalized: ${oldScore.toFixed(2)} -> ${score.toFixed(2)} (${Math.round(daysSince * 10) / 10}d ago, ${repeatPenalty}x)`);
        }
      }
    }

    const r = {
      tmdbId: cid,
      score,
      reasons,
      title: m.title,
      release_date: m.release_date,
      genres: feats.genres,
      poster_path: m.poster_path,
      voteCategory: feats.voteCategory,
      voteAverage: feats.voteAverage,
      voteCount: feats.voteCount,
      contributingFilms,
      // Phase 3: For diversity filtering
      directors: feats.directors,
      studios: feats.productionCompanies,
      actors: feats.cast.slice(0, 3), // Top 3 billed actors
      // Multi-source recommendation data
      sources: sourceMeta?.sources,
      consensusLevel: sourceMeta?.consensusLevel,
      reliabilityMultiplier,
      metadataCompleteness
    };
    resultsAcc.push(r);
    // Early return the result; caller will slice after sorting
    return r;
  });
  const results = pool.filter(Boolean) as Array<{
    tmdbId: number;
    score: number;
    reasons: string[];
    title?: string;
    release_date?: string;
    genres?: string[];
    poster_path?: string | null;
    voteCategory?: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard';
    voteAverage?: number;
    voteCount?: number;
    contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
    sources?: string[];
    consensusLevel?: 'high' | 'medium' | 'low';
    directors?: string[];
    studios?: string[];
    actors?: string[];
    reliabilityMultiplier?: number;
    metadataCompleteness?: number;
  }>;
  results.sort((a, b) => b.score - a.score);

  // Phase 3: Rerank with MMR for better novelty vs relevance
  const mmrReranked = applyMMRRerank(results, {
    lambda: params.mmrLambda ?? 0.25,
    topK: Math.min(
      results.length,
      Math.max(desired * (params.mmrTopKFactor ?? 3), desired + 12)
    )
  });

  // Phase 3b: Apply diversity filtering (limits increased for 24-section UI)
  const diversified = applyDiversityFilter(mmrReranked, {
    maxSameDirector: 4,
    maxSameGenre: 15,
    maxSameDecade: 10,
    maxSameStudio: 6,
    maxSameActor: 6
  });

  return diversified.slice(0, desired);
}

export async function deleteFilmMapping(userId: string, uri: string) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase
    .from('film_tmdb_map')
    .delete()
    .eq('user_id', userId)
    .eq('uri', uri);
  if (error) throw error;
}

// ============================================================================
// Phase 5+: Adaptive Exploration & Personalized Learning
// ============================================================================

/**
 * Get adaptive exploration rate based on user's response to exploratory picks
 * Rate adjusts between 5-30% based on how user rates exploratory suggestions
 */
export async function getAdaptiveExplorationRate(userId: string): Promise<number> {
  if (!supabase) return 0.15; // Default 15%

  try {
    const { data, error } = await supabase
      .from('user_exploration_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[AdaptiveExploration] Error fetching stats:', error);
      return 0.15;
    }

    if (!data || data.exploratory_films_rated < 10) {
      // Need at least 10 rated exploratory films to adjust
      console.log('[AdaptiveExploration] Using default rate (insufficient data)', {
        ratedCount: data?.exploratory_films_rated || 0
      });
      return 0.15;
    }

    const avgRating = data.exploratory_avg_rating;
    let newRate = data.exploration_rate;

    // Adjust rate based on average rating
    if (avgRating >= 4.0) {
      // User loves exploratory picks - increase discovery
      newRate = Math.min(0.30, data.exploration_rate + 0.05);
      console.log('[AdaptiveExploration] Increasing rate (high satisfaction)', {
        avgRating,
        oldRate: data.exploration_rate,
        newRate
      });
    } else if (avgRating < 3.0) {
      // User dislikes exploratory picks - decrease discovery
      newRate = Math.max(0.05, data.exploration_rate - 0.05);
      console.log('[AdaptiveExploration] Decreasing rate (low satisfaction)', {
        avgRating,
        oldRate: data.exploration_rate,
        newRate
      });
    } else {
      console.log('[AdaptiveExploration] Maintaining rate (neutral satisfaction)', {
        avgRating,
        rate: data.exploration_rate
      });
    }

    // Update rate if changed
    if (newRate !== data.exploration_rate) {
      await supabase
        .from('user_exploration_stats')
        .update({
          exploration_rate: newRate,
          last_updated: new Date().toISOString()
        })
        .eq('user_id', userId);
    }

    return newRate;
  } catch (e) {
    console.error('[AdaptiveExploration] Exception:', e);
    return 0.15;
  }
}

/**
 * Update exploration feedback when user rates an exploratory film
 * This feeds into the adaptive exploration rate calculation
 */
export async function updateExplorationFeedback(
  userId: string,
  tmdbId: number,
  rating: number,
  wasExploratory: boolean
) {
  if (!supabase || !wasExploratory) return;

  try {
    const { data: current } = await supabase
      .from('user_exploration_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!current) {
      // Create initial record
      await supabase.from('user_exploration_stats').insert({
        user_id: userId,
        exploration_rate: 0.15,
        exploratory_films_rated: 1,
        exploratory_avg_rating: rating,
        last_updated: new Date().toISOString()
      });

      console.log('[ExplorationFeedback] Created initial stats', { userId, rating });
    } else {
      // Update running average
      const newCount = current.exploratory_films_rated + 1;
      const newAvg = ((current.exploratory_avg_rating * current.exploratory_films_rated) + rating) / newCount;

      await supabase.from('user_exploration_stats').update({
        exploratory_films_rated: newCount,
        exploratory_avg_rating: Number(newAvg.toFixed(2)),
        last_updated: new Date().toISOString()
      }).eq('user_id', userId);

      console.log('[ExplorationFeedback] Updated stats', {
        userId,
        newCount,
        newAvg: newAvg.toFixed(2),
        rating
      });
    }
  } catch (e) {
    console.error('[ExplorationFeedback] Error:', e);
  }
}

/**
 * Get personalized adjacent genres based on learned preferences
 * Falls back to generic adjacency map if insufficient data
 */
export async function getPersonalizedAdjacentGenres(
  userId: string,
  topGenres: Array<{ id: number; name: string }>
): Promise<Array<{ genreId: number; genreName: string; confidence: number }>> {
  if (!supabase) return [];

  try {
    const adjacentGenres: Array<{ genreId: number; genreName: string; confidence: number }> = [];

    for (const genre of topGenres.slice(0, 3)) {
      // Get learned adjacencies for this genre
      const { data, error } = await supabase
        .from('user_adjacent_preferences')
        .select('to_genre_id, to_genre_name, success_rate, rating_count')
        .eq('user_id', userId)
        .eq('from_genre_id', genre.id)
        .gte('rating_count', 3) // Need at least 3 ratings
        .gte('success_rate', 0.6) // 60%+ success rate
        .order('success_rate', { ascending: false });

      if (error) {
        console.error('[PersonalizedAdjacency] Error:', error);
        continue;
      }

      if (data && data.length > 0) {
        // Use learned adjacencies
        console.log('[PersonalizedAdjacency] Found learned preferences', {
          fromGenre: genre.name,
          count: data.length
        });

        data.slice(0, 3).forEach(row => {
          adjacentGenres.push({
            genreId: row.to_genre_id,
            genreName: row.to_genre_name,
            confidence: row.success_rate
          });
        });
      }
    }

    return adjacentGenres;
  } catch (e) {
    console.error('[PersonalizedAdjacency] Exception:', e);
    return [];
  }
}

/**
 * Update adjacent genre preferences when user rates a film
 * Tracks which genre transitions are successful for this user
 */
export async function updateAdjacentPreferences(
  userId: string,
  filmGenres: Array<{ id: number; name: string }>,
  userTopGenres: Array<{ id: number; name: string }>,
  rating: number
) {
  if (!supabase || !filmGenres || filmGenres.length === 0) return;

  try {
    const topGenreIds = new Set(userTopGenres.map(g => g.id));
    const isSuccess = rating >= 3.5;

    // Find adjacent transitions (film genres not in user's top genres)
    for (const filmGenre of filmGenres) {
      if (topGenreIds.has(filmGenre.id)) continue; // Skip if already a top genre

      // This is an adjacent genre - find which top genre it's adjacent to
      for (const topGenre of userTopGenres.slice(0, 3)) {
        // Check if this transition exists
        const { data: existing } = await supabase
          .from('user_adjacent_preferences')
          .select('*')
          .eq('user_id', userId)
          .eq('from_genre_id', topGenre.id)
          .eq('to_genre_id', filmGenre.id)
          .maybeSingle();

        if (existing) {
          // Update existing preference
          const newCount = existing.rating_count + 1;
          const newAvg = ((existing.avg_rating * existing.rating_count) + rating) / newCount;
          const successCount = (existing.success_rate * existing.rating_count) + (isSuccess ? 1 : 0);
          const newSuccessRate = successCount / newCount;

          await supabase
            .from('user_adjacent_preferences')
            .update({
              rating_count: newCount,
              avg_rating: Number(newAvg.toFixed(2)),
              success_rate: Number(newSuccessRate.toFixed(2)),
              last_updated: new Date().toISOString()
            })
            .eq('id', existing.id);

          console.log('[AdjacentPreferences] Updated', {
            from: topGenre.name,
            to: filmGenre.name,
            newCount,
            newSuccessRate: newSuccessRate.toFixed(2)
          });
        } else {
          // Create new preference
          await supabase
            .from('user_adjacent_preferences')
            .insert({
              user_id: userId,
              from_genre_id: topGenre.id,
              from_genre_name: topGenre.name,
              to_genre_id: filmGenre.id,
              to_genre_name: filmGenre.name,
              rating_count: 1,
              avg_rating: rating,
              success_rate: isSuccess ? 1.0 : 0.0,
              last_updated: new Date().toISOString()
            });

          console.log('[AdjacentPreferences] Created', {
            from: topGenre.name,
            to: filmGenre.name,
            rating
          });
        }
      }
    }
  } catch (e) {
    console.error('[AdjacentPreferences] Error:', e);
  }
}

/**
 * Batch process historical ratings on import to populate adaptive learning data
 * This gives new users personalized recommendations immediately
 */
export async function learnFromHistoricalData(userId: string) {
  if (!supabase) {
    console.log('[BatchLearning] Supabase not initialized');
    return;
  }

  try {
    console.log('[BatchLearning] Starting analysis of historical data for user:', userId);

    // 1. Get all film events for this user (with pagination - PostgREST defaults to 1000 max)
    const pageSize = 1000;
    let films: Array<{ uri: string; title: string; rating: number | null; liked: boolean | null }> = [];
    let from = 0;

    while (true) {
      const { data: pageData, error: pageError } = await supabase
        .from('film_events')
        .select('uri, title, rating, liked')
        .eq('user_id', userId)
        .range(from, from + pageSize - 1);

      if (pageError) {
        console.error('[BatchLearning] Error fetching films page:', pageError);
        break;
      }

      const rows = pageData ?? [];
      films.push(...rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    if (films.length < 10) {
      console.log('[BatchLearning] Not enough rated films for learning', { count: films.length });
      return;
    }

    console.log('[BatchLearning] Processing', films.length, 'rated films');

    // 2. Get film mappings to TMDB IDs (with pagination)
    let mappings: Array<{ uri: string; tmdb_id: number }> = [];
    from = 0;

    while (true) {
      const { data: pageData, error: pageError } = await supabase
        .from('film_tmdb_map')
        .select('uri, tmdb_id')
        .eq('user_id', userId)
        .range(from, from + pageSize - 1);

      if (pageError) {
        console.error('[BatchLearning] Error fetching mappings page:', pageError);
        break;
      }

      const rows = pageData ?? [];
      mappings.push(...rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    if (mappings.length === 0) {
      console.error('[BatchLearning] No mappings found');
      return;
    }

    const uriToTmdbId = new Map(mappings.map(m => [m.uri, m.tmdb_id]));
    console.log('[BatchLearning] Found', mappings.length, 'TMDB mappings');


    // 3. Get TMDB details for mapped films (in batches)
    const tmdbIds = Array.from(new Set(mappings.map(m => m.tmdb_id)));
    const batchSize = 100;
    const tmdbDetails = new Map<number, any>();

    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize);
      const { data: cached } = await supabase
        .from('tmdb_movies')
        .select('tmdb_id, data')
        .in('tmdb_id', batch);

      cached?.forEach(row => {
        if (row.data) {
          tmdbDetails.set(row.tmdb_id, row.data);
        }
      });
    }

    console.log('[BatchLearning] Loaded TMDB details for', tmdbDetails.size, 'films');

    // 4. Build taste profile to get top genres
    const mappingsMap = new Map(mappings.map(m => [m.uri, m.tmdb_id]));
    const profile = await buildTasteProfile({
      films: films.map(f => ({
        uri: f.uri,
        rating: f.rating ?? undefined,
        liked: f.liked ?? undefined
      })),
      mappings: mappingsMap,
      topN: 10,
      tmdbDetails: tmdbDetails // Pass pre-fetched details
    });


    console.log('[BatchLearning] Built taste profile', {
      topGenres: profile.topGenres.length,
      totalFilms: films.length
    });

    // 5. Analyze genre transitions and populate adjacency preferences
    let transitionsProcessed = 0;
    const topGenreIds = new Set(profile.topGenres.slice(0, 3).map(g => g.id));

    for (const film of films) {
      const tmdbId = uriToTmdbId.get(film.uri);
      if (!tmdbId) continue;

      const details = tmdbDetails.get(tmdbId);
      if (!details || !details.genres) continue;

      const rating = film.rating ?? 0;
      if (rating < 1) continue; // Skip unrated

      // Check for adjacent genre transitions
      const filmGenres = details.genres as Array<{ id: number; name: string }>;

      await updateAdjacentPreferences(
        userId,
        filmGenres,
        profile.topGenres,
        rating
      );

      transitionsProcessed++;
    }

    console.log('[BatchLearning] Processed', transitionsProcessed, 'genre transitions');

    // 6. Calculate initial exploration stats based on high-rated variety
    const highRated = films.filter(f => (f.rating ?? 0) >= 4);
    const exploratory = films.filter(f => {
      const tmdbId = uriToTmdbId.get(f.uri);
      if (!tmdbId) return false;

      const details = tmdbDetails.get(tmdbId);
      if (!details || !details.genres) return false;

      // Film is exploratory if it has genres outside top 3
      const filmGenres = details.genres as Array<{ id: number }>;
      return filmGenres.some(g => !topGenreIds.has(g.id));
    });

    if (exploratory.length > 0) {
      const exploratoryAvg = exploratory.reduce((sum, f) => sum + (f.rating ?? 0), 0) / exploratory.length;

      // Seed exploration stats
      await supabase
        .from('user_exploration_stats')
        .upsert({
          user_id: userId,
          exploration_rate: 0.15, // Start at default
          exploratory_films_rated: exploratory.length,
          exploratory_avg_rating: Number(exploratoryAvg.toFixed(2)),
          last_updated: new Date().toISOString()
        });

      console.log('[BatchLearning] Seeded exploration stats', {
        exploratoryFilms: exploratory.length,
        avgRating: exploratoryAvg.toFixed(2)
      });
    }

    console.log('[BatchLearning] ✅ Historical learning complete!', {
      totalFilms: films.length,
      highRated: highRated.length,
      exploratoryFilms: exploratory.length,
      transitionsTracked: transitionsProcessed
    });

  } catch (e) {
    console.error('[BatchLearning] Error during batch learning:', e);
  }
}

/**
 * Log suggestion exposures for repeat-suggestion tracking and counterfactual analysis
 */
export async function logSuggestionExposure(params: {
  userId: string;
  suggestions: Array<{
    tmdbId: number;
    category?: string;
    baseScore?: number;
    consensusLevel?: 'high' | 'medium' | 'low';
    sources?: string[];
    reasons?: string[];
    mmrLambda?: number;
    diversityRank?: number;
    hasPoster?: boolean;
    hasTrailer?: boolean;
    metadataCompleteness?: number;
  }>;
  sessionContext?: {
    discoveryLevel?: number;
    excludeGenres?: string;
    yearMin?: string;
    yearMax?: string;
    mode?: 'quick' | 'deep';
    contextMode?: string;
  };
}): Promise<void> {
  if (!supabase) {
    console.warn('[ExposureLog] Supabase not available');
    return;
  }

  const { userId, suggestions, sessionContext } = params;

  try {
    const exposureLogs = suggestions.map(s => ({
      user_id: userId,
      tmdb_id: s.tmdbId,
      category: s.category,
      session_context: sessionContext,
      base_score: s.baseScore,
      consensus_level: s.consensusLevel,
      sources: s.sources,
      reasons: s.reasons,
      mmr_lambda: s.mmrLambda,
      diversity_rank: s.diversityRank,
      has_poster: s.hasPoster,
      has_trailer: s.hasTrailer,
      metadata_completeness: s.metadataCompleteness,
    }));

    const { error } = await supabase
      .from('suggestion_exposure_log')
      .insert(exposureLogs);

    if (error) {
      console.error('[ExposureLog] Error logging exposures:', error);
    } else {
      console.log('[ExposureLog] Logged', exposureLogs.length, 'suggestion exposures');
    }
  } catch (e) {
    console.error('[ExposureLog] Exception logging exposures:', e);
  }
}

/**
 * Get recently exposed movie IDs with their most recent exposure timestamp.
 * Used to apply decay penalties to recently shown movies.
 * Returns a Map of tmdbId -> days since last exposure for efficient lookup.
 */
export async function getRecentExposures(
  userId: string,
  lookbackDays: number = 14
): Promise<Map<number, number>> {
  if (!supabase) {
    return new Map();
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const { data: exposures, error } = await supabase
      .from('suggestion_exposure_log')
      .select('tmdb_id, exposed_at')
      .eq('user_id', userId)
      .gte('exposed_at', cutoffDate.toISOString())
      .order('exposed_at', { ascending: false });

    if (error) {
      console.error('[RecentExposures] Error fetching exposures:', error);
      return new Map();
    }

    if (!exposures || exposures.length === 0) {
      return new Map();
    }

    // Build map of tmdbId -> days since most recent exposure
    const now = Date.now();
    const exposureMap = new Map<number, number>();

    for (const exp of exposures) {
      const tmdbId = exp.tmdb_id;
      // Only store the most recent (first) exposure for each movie
      if (!exposureMap.has(tmdbId)) {
        const exposedAt = new Date(exp.exposed_at).getTime();
        const daysSince = (now - exposedAt) / (1000 * 60 * 60 * 24);
        exposureMap.set(tmdbId, daysSince);
      }
    }

    console.log('[RecentExposures] Loaded exposure data', {
      uniqueMovies: exposureMap.size,
      lookbackDays,
    });

    return exposureMap;
  } catch (e) {
    console.error('[RecentExposures] Exception:', e);
    return new Map();
  }
}

/**
 * Calculate repeat-suggestion rate for a user
 */
export async function getRepeatSuggestionStats(userId: string, lookbackDays = 30): Promise<{
  totalExposures: number;
  uniqueSuggestions: number;
  repeatRate: number;
  avgTimeBetweenRepeats: number | null;
  topRepeatedSuggestions: Array<{ tmdbId: number; exposureCount: number; firstSeen: string; lastSeen: string }>;
}> {
  if (!supabase) {
    return {
      totalExposures: 0,
      uniqueSuggestions: 0,
      repeatRate: 0,
      avgTimeBetweenRepeats: null,
      topRepeatedSuggestions: [],
    };
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const { data: exposures, error } = await supabase
      .from('suggestion_exposure_log')
      .select('tmdb_id, exposed_at')
      .eq('user_id', userId)
      .gte('exposed_at', cutoffDate.toISOString())
      .order('exposed_at', { ascending: true });

    if (error) {
      console.error('[RepeatStats] Error fetching exposures:', error);
      return {
        totalExposures: 0,
        uniqueSuggestions: 0,
        repeatRate: 0,
        avgTimeBetweenRepeats: null,
        topRepeatedSuggestions: [],
      };
    }

    if (!exposures || exposures.length === 0) {
      return {
        totalExposures: 0,
        uniqueSuggestions: 0,
        repeatRate: 0,
        avgTimeBetweenRepeats: null,
        topRepeatedSuggestions: [],
      };
    }

    const totalExposures = exposures.length;
    const uniqueSuggestions = new Set(exposures.map(e => e.tmdb_id)).size;
    const repeatRate = uniqueSuggestions > 0 ? (totalExposures - uniqueSuggestions) / totalExposures : 0;

    // Group by tmdb_id to find repeats
    const exposuresByMovie = new Map<number, Array<string>>();
    for (const exp of exposures) {
      const existing = exposuresByMovie.get(exp.tmdb_id) || [];
      existing.push(exp.exposed_at);
      exposuresByMovie.set(exp.tmdb_id, existing);
    }

    // Find repeated suggestions
    const repeated = Array.from(exposuresByMovie.entries())
      .filter(([_, timestamps]) => timestamps.length > 1)
      .map(([tmdbId, timestamps]) => ({
        tmdbId,
        exposureCount: timestamps.length,
        firstSeen: timestamps[0],
        lastSeen: timestamps[timestamps.length - 1],
      }))
      .sort((a, b) => b.exposureCount - a.exposureCount)
      .slice(0, 10);

    // Calculate average time between repeats
    let totalTimeDiffs = 0;
    let repeatPairCount = 0;
    for (const [_, timestamps] of exposuresByMovie.entries()) {
      if (timestamps.length > 1) {
        for (let i = 1; i < timestamps.length; i++) {
          const diff = new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime();
          totalTimeDiffs += diff;
          repeatPairCount++;
        }
      }
    }

    const avgTimeBetweenRepeats = repeatPairCount > 0
      ? totalTimeDiffs / repeatPairCount / (1000 * 60 * 60 * 24) // Convert to days
      : null;

    return {
      totalExposures,
      uniqueSuggestions,
      repeatRate,
      avgTimeBetweenRepeats,
      topRepeatedSuggestions: repeated,
    };
  } catch (e) {
    console.error('[RepeatStats] Exception calculating repeat stats:', e);
    return {
      totalExposures: 0,
      uniqueSuggestions: 0,
      repeatRate: 0,
      avgTimeBetweenRepeats: null,
      topRepeatedSuggestions: [],
    };
  }
}

/**
 * Get counterfactual replay data for A/B testing parameter variations
 * Retrieves scored suggestions with their metadata to simulate alternative ranking strategies
 */
export async function getCounterfactualReplayData(params: {
  userId: string;
  lookbackDays?: number;
  minScore?: number;
  categories?: string[];
}): Promise<Array<{
  tmdbId: number;
  exposedAt: string;
  category: string;
  baseScore: number;
  consensusLevel: string;
  sources: string[];
  reasons: string[];
  mmrLambda: number;
  diversityRank: number;
  metadataCompleteness: number;
  sessionContext: any;
  // Join with feedback if available
  feedbackType?: 'positive' | 'negative' | null;
  feedbackAt?: string | null;
}>> {
  if (!supabase) {
    return [];
  }

  const { userId, lookbackDays = 30, minScore, categories } = params;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    let query = supabase
      .from('suggestion_exposure_log')
      .select('*')
      .eq('user_id', userId)
      .gte('exposed_at', cutoffDate.toISOString())
      .order('exposed_at', { ascending: false });

    if (minScore !== undefined) {
      query = query.gte('base_score', minScore);
    }

    if (categories && categories.length > 0) {
      query = query.in('category', categories);
    }

    const { data: exposures, error } = await query;

    if (error) {
      console.error('[CounterfactualReplay] Error fetching exposure data:', error);
      return [];
    }

    if (!exposures || exposures.length === 0) {
      return [];
    }

    // Join with feedback data
    const tmdbIds = exposures.map(e => e.tmdb_id);
    const { data: feedbackData } = await supabase
      .from('suggestion_feedback')
      .select('tmdb_id, feedback_type, created_at')
      .eq('user_id', userId)
      .in('tmdb_id', tmdbIds);

    const feedbackMap = new Map<number, { type: string; at: string }>();
    if (feedbackData) {
      for (const fb of feedbackData) {
        feedbackMap.set(fb.tmdb_id, { type: fb.feedback_type, at: fb.created_at });
      }
    }

    return exposures.map(exp => {
      const feedback = feedbackMap.get(exp.tmdb_id);
      return {
        tmdbId: exp.tmdb_id,
        exposedAt: exp.exposed_at,
        category: exp.category || '',
        baseScore: exp.base_score || 0,
        consensusLevel: exp.consensus_level || 'low',
        sources: exp.sources || [],
        reasons: exp.reasons || [],
        mmrLambda: exp.mmr_lambda || 0.25,
        diversityRank: exp.diversity_rank || 0,
        metadataCompleteness: exp.metadata_completeness || 0,
        sessionContext: exp.session_context || {},
        feedbackType: feedback?.type as 'positive' | 'negative' | null || null,
        feedbackAt: feedback?.at || null,
      };
    });
  } catch (e) {
    console.error('[CounterfactualReplay] Exception fetching data:', e);
    return [];
  }
}
