'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';

type TimeFilter = 'all' | 'year' | 'month';

type TMDBDetails = {
  id: number;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  genres?: Array<{ id: number; name: string }>;
  production_companies?: Array<{ id: number; name: string; logo_path?: string }>;
  credits?: {
    cast?: Array<{ id: number; name: string; profile_path?: string; order?: number }>;
    crew?: Array<{ id: number; name: string; job?: string; profile_path?: string }>;
  };
  keywords?: {
    keywords?: Array<{ id: number; name: string }>;
    results?: Array<{ id: number; name: string }>;
  };
};

export default function StatsPage() {
  const { films, loading } = useImportData();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [filmMappings, setFilmMappings] = useState<Map<string, number>>(new Map());
  const [mappingCoverage, setMappingCoverage] = useState<{ mapped: number; total: number } | null>(null);
  const [explorationStats, setExplorationStats] = useState<{
    exploration_rate: number;
    exploratory_films_rated: number;
    exploratory_avg_rating: number;
  } | null>(null);
  const [adjacentPrefs, setAdjacentPrefs] = useState<Array<{
    from_genre_name: string;
    to_genre_name: string;
    success_rate: number;
    rating_count: number;
  }>>([]);

  useEffect(() => {
    async function getUid() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      setUid(data?.session?.user?.id ?? null);
    }
    getUid();
  }, []);

  // Fetch exploration stats and adjacent preferences
  useEffect(() => {
    async function fetchExplorationStats() {
      if (!supabase || !uid) return;

      try {
        // Fetch exploration stats
        const { data: stats } = await supabase
          .from('user_exploration_stats')
          .select('*')
          .eq('user_id', uid)
          .maybeSingle();

        setExplorationStats(stats);

        // Fetch learned adjacencies
        const { data: prefs } = await supabase
          .from('user_adjacent_preferences')
          .select('from_genre_name, to_genre_name, success_rate, rating_count')
          .eq('user_id', uid)
          .gte('rating_count', 3)
          .gte('success_rate', 0.6)
          .order('success_rate', { ascending: false })
          .limit(10);

        setAdjacentPrefs(prefs || []);
      } catch (e) {
        console.error('[Stats] Error fetching exploration data:', e);
      }
    }

    fetchExplorationStats();
  }, [uid]);


  const filteredFilms = useMemo(() => {
    if (!films) return [];

    const watched = films.filter(f => (f.watchCount ?? 0) > 0);

    if (timeFilter === 'all') return watched;

    const now = new Date();
    const cutoff = timeFilter === 'year'
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);

    return watched.filter(f => {
      if (!f.lastDate) return false;
      const filmDate = new Date(f.lastDate);
      return filmDate >= cutoff;
    });
  }, [films, timeFilter]);

  // Load TMDB details for mapped films
  useEffect(() => {
    if (!uid || !filteredFilms.length) {
      console.log('[Stats] Skipping TMDB load:', { uid, filmCount: filteredFilms.length });
      return;
    }

    async function loadTmdbDetails() {
      console.log('[Stats] Starting TMDB details load', { uid, filmCount: filteredFilms.length });
      setLoadingDetails(true);
      setDetailsError(null);

      // Add timeout protection (60 seconds for large libraries)
      const timeoutId = setTimeout(() => {
        console.error('[Stats] Load timeout after 60 seconds');
        setDetailsError('Loading took too long. Please try again or reduce your time filter.');
        setLoadingDetails(false);
      }, 60000);

      try {
        // Get ALL mappings for this user instead of using .in() which can hit query limits
        console.log('[Stats] Fetching mappings for user');
        const { data: allMappings, error: mappingError } = await supabase!
          .from('film_tmdb_map')
          .select('uri, tmdb_id')
          .eq('user_id', uid);

        if (mappingError) {
          console.error('[Stats] Error fetching mappings:', mappingError);
          setDetailsError(`Error loading mappings: ${mappingError.message}`);
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        if (!allMappings || allMappings.length === 0) {
          console.log('[Stats] No mappings found for user');
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        console.log('[Stats] Mappings loaded:', allMappings.length);

        // Store mappings for preference calculation
        const mappingsMap = new Map<string, number>();
        const filteredUris = new Set(filteredFilms.map(f => f.uri));
        
        // Also include watchlist URIs so watchlist analysis works
        const watchlistFilms = films?.filter(f => f.onWatchlist) ?? [];
        watchlistFilms.forEach(f => filteredUris.add(f.uri));

        // Filter to only mappings for currently filtered films AND watchlist
        const relevantMappings = allMappings.filter(m => filteredUris.has(m.uri));
        console.log('[Stats] Relevant mappings:', relevantMappings.length, 'of', filteredUris.size, 'films (including', watchlistFilms.length, 'watchlist)');

        // Track mapping coverage for UI feedback
        setMappingCoverage({ mapped: relevantMappings.length, total: filteredUris.size });

        relevantMappings.forEach(m => mappingsMap.set(m.uri, m.tmdb_id));
        setFilmMappings(mappingsMap);

        const tmdbIds = relevantMappings.map(m => m.tmdb_id);

        if (tmdbIds.length === 0) {
          console.log('[Stats] No TMDB IDs to fetch');
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        console.log('[Stats] Fetching cached TMDB details for', tmdbIds.length, 'IDs');

        // Fetch from cache in batches to avoid query size limits
        const batchSize = 500;
        const detailsMap = new Map<number, TMDBDetails>();

        for (let i = 0; i < tmdbIds.length; i += batchSize) {
          const batch = tmdbIds.slice(i, i + batchSize);
          console.log(`[Stats] Fetching batch ${i / batchSize + 1}:`, batch.length, 'IDs');

          const { data: cached, error: cacheError } = await supabase!
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', batch);

          if (cacheError) {
            console.error('[Stats] Error fetching cached movies:', cacheError);
            continue;
          }

          console.log('[Stats] Cached results for batch:', cached?.length ?? 0);

          for (const row of cached ?? []) {
            const data = row.data as any;
            // Accept cached data even if incomplete - we'll use what's available
            // This prevents hundreds of individual API calls
            if (data) {
              detailsMap.set(row.tmdb_id, data);
            }
          }
        }

        // Debug: check how many have the required fields
        let withGenres = 0, withCredits = 0, withKeywords = 0;
        for (const [, data] of detailsMap) {
          if (data.genres?.length) withGenres++;
          if (data.credits?.cast?.length || data.credits?.crew?.length) withCredits++;
          if (data.keywords?.keywords?.length || data.keywords?.results?.length) withKeywords++;
        }
        console.log('[Stats] Details quality check:', { 
          total: detailsMap.size, 
          withGenres, 
          withCredits, 
          withKeywords,
          note: 'If these are 0, enrichment may not have completed'
        });

        console.log('[Stats] Total details loaded:', detailsMap.size);
        setTmdbDetails(detailsMap);
        clearTimeout(timeoutId);
      } catch (e) {
        console.error('[Stats] Error loading TMDB details', e);
        setDetailsError(e instanceof Error ? e.message : 'Unknown error occurred');
        clearTimeout(timeoutId);
      } finally {
        console.log('[Stats] Finished loading TMDB details');
        setLoadingDetails(false);
      }
    }

    loadTmdbDetails();
  }, [uid, filteredFilms]);

  // Calculate user statistics for enhanced weighting
  const ratedFilms = filteredFilms.filter(f => f.rating != null);
  const ratings = ratedFilms.map(f => f.rating!);
  const avgRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : 3.0;
  const variance = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + Math.pow(r - avgRating, 2), 0) / ratings.length
    : 1.0;
  const stdDevRating = Math.sqrt(variance);

  // Enhanced weighting function matching the Suggestions algorithm
  // Includes: rating normalization, liked boost, rewatch boost, and recency decay
  const getEnhancedWeight = (film: typeof filteredFilms[0]): number => {
    const r = film.rating ?? avgRating;
    const now = new Date();
    const watchDate = film.lastDate ? new Date(film.lastDate) : new Date();
    const daysSinceWatch = (now.getTime() - watchDate.getTime()) / (1000 * 60 * 60 * 24);

    // Normalize rating to user's scale (z-score), only positive weights
    const normalizedRating = (r - avgRating) / Math.max(stdDevRating, 0.5);
    let weight = Math.max(0, normalizedRating + 1); // Shift to ensure positive

    // Boost for liked films (1.5x)
    if (film.liked) weight *= 1.5;

    // Strong boost for rewatches (1.8x - indicates strong preference)
    if (film.rewatch) weight *= 1.8;

    // Recency decay (exponential, half-life of 1 year)
    const recencyFactor = Math.exp(-daysSinceWatch / 365);
    weight *= (0.5 + 0.5 * recencyFactor); // 50% base + 50% recency-based

    return weight;
  };


  const stats = useMemo(() => {
    if (!filteredFilms || filteredFilms.length === 0) return null;

    const watchlist = films?.filter(f => f.onWatchlist) ?? [];
    const rated = filteredFilms.filter(f => f.rating != null);
    const rewatched = filteredFilms.filter(f => f.rewatch);
    const liked = filteredFilms.filter(f => f.liked);

    // Ratings distribution
    const ratingsBuckets = [0, 0, 0, 0, 0, 0];
    for (const f of rated) {
      const r = Math.round(f.rating!);
      if (r >= 0 && r <= 5) ratingsBuckets[r] += 1;
    }

    const avgRating = rated.length > 0
      ? (rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length).toFixed(2)
      : '0.00';

    // Watches by year
    const byYear = new Map<number, number>();
    for (const f of filteredFilms) {
      if (f.year != null) byYear.set(f.year, (byYear.get(f.year) ?? 0) + 1);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    const yearCounts = years.map(y => byYear.get(y)!);

    // Decade distribution
    const byDecade = new Map<string, number>();
    for (const f of filteredFilms) {
      if (f.year != null) {
        const decade = `${Math.floor(f.year / 10) * 10}s`;
        byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
      }
    }
    const decades = Array.from(byDecade.keys()).sort();
    const decadeCounts = decades.map(d => byDecade.get(d)!);

    const totalWatches = filteredFilms.reduce((sum, f) => sum + (f.watchCount ?? 0), 0);

    // Calculate total rewatch entries
    // A film marked as rewatch=true means the user has seen it before (at least once prior to this viewing)
    // - If rewatch=true and watchCount=1: This is a rewatch of a previously-watched film (count as 1 rewatch)
    // - If rewatch=true and watchCount>1: Multiple diary entries, all but first are rewatches
    // - If rewatch=false and watchCount>1: Multiple entries in diary (count watchCount-1 as rewatches)
    const totalRewatchEntries = filteredFilms.reduce((sum, f) => {
      const wc = f.watchCount ?? 0;
      if (f.rewatch) {
        // Film is marked as rewatch - count at least 1 rewatch, or more if multiple diary entries
        return sum + Math.max(1, wc - 1);
      } else if (wc > 1) {
        // Not marked as rewatch but has multiple diary entries - those are rewatches
        return sum + (wc - 1);
      }
      return sum;
    }, 0);


    // Most watched film
    const mostWatched = filteredFilms.reduce((max, f) =>
      (f.watchCount ?? 0) > (max.watchCount ?? 0) ? f : max
      , filteredFilms[0]);

    // Genre analysis with weighted preferences
    const genreCounts = new Map<string, number>();
    const genreWeights = new Map<string, number>(); // Weighted by rating + liked
    const actorCounts = new Map<string, { count: number; profile?: string }>();
    const actorWeights = new Map<string, number>();
    const directorCounts = new Map<string, { count: number; profile?: string }>();
    const directorWeights = new Map<string, number>();
    const keywordWeights = new Map<string, number>(); // Sub-genres/themes
    const studioWeights = new Map<string, number>(); // Production companies

    // Track films by preference strength for the "Taste Profile" section
    const absoluteFavorites = filteredFilms.filter(f => (f.rating ?? 0) >= 4.5 && f.liked);
    const highlyRated = filteredFilms.filter(f => (f.rating ?? 0) >= 4);
    const likedFilms = filteredFilms.filter(f => f.liked);
    const lowRatedButLiked = filteredFilms.filter(f => (f.rating ?? 0) < 3 && (f.rating ?? 0) > 0 && f.liked);

    for (const film of filteredFilms) {
      const weight = getEnhancedWeight(film);

      // Find TMDB ID for this film
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;

      if (details) {
        // Count genres (both raw count and weighted)
        details.genres?.forEach(genre => {
          genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
          genreWeights.set(genre.name, (genreWeights.get(genre.name) ?? 0) + weight);
        });

        // Count top 5 actors (both raw and weighted)
        details.credits?.cast?.slice(0, 5).forEach(actor => {
          const current = actorCounts.get(actor.name) ?? { count: 0 };
          actorCounts.set(actor.name, {
            count: current.count + 1,
            profile: actor.profile_path ?? current.profile
          });
          actorWeights.set(actor.name, (actorWeights.get(actor.name) ?? 0) + weight);
        });

        // Count directors (both raw and weighted)
        details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
          const current = directorCounts.get(director.name) ?? { count: 0 };
          directorCounts.set(director.name, {
            count: current.count + 1,
            profile: director.profile_path ?? current.profile
          });
          directorWeights.set(director.name, (directorWeights.get(director.name) ?? 0) + weight);
        });

        // Extract keywords if available (these are sub-genres/themes)
        const keywords = (details as any).keywords?.keywords || (details as any).keywords?.results || [];
        keywords.forEach((k: { name: string }) => {
          keywordWeights.set(k.name, (keywordWeights.get(k.name) ?? 0) + weight);
        });

        // Extract production companies/studios
        const companies = details.production_companies || [];
        companies.forEach((c: { name: string }) => {
          studioWeights.set(c.name, (studioWeights.get(c.name) ?? 0) + weight);
        });
      }
    }

    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topGenresByWeight = Array.from(genreWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topActors = Array.from(actorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const topActorsByWeight = Array.from(actorWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, weight]) => ({ name, weight, ...actorCounts.get(name)! }));

    const topDirectors = Array.from(directorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const topDirectorsByWeight = Array.from(directorWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, weight]) => ({ name, weight, ...directorCounts.get(name)! }));

    const topKeywords = Array.from(keywordWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    // Top studios
    const topStudios = Array.from(studioWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // === AVOIDANCE TRACKING ===
    // Track genres, keywords, and directors - comparing LIKED vs DISLIKED
    // Only avoid something if user dislikes it MORE than they like it
    
    // Track both positive and negative signals
    const genreLikedCount = new Map<string, number>();
    const genreDislikedCount = new Map<string, number>();
    const keywordLikedCount = new Map<string, number>();
    const keywordDislikedCount = new Map<string, number>();
    const directorLikedCount = new Map<string, number>();
    const directorDislikedCount = new Map<string, number>();

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
    //   2. User rated it >= 3 stars (positive rating)
    // A film is considered "disliked" if:
    //   1. User rated it 0.5-1.5 stars AND did NOT click "like"
    //   (Rating of 0 means "no rating", 2 is "meh" - neither counts as dislike)
    // A film is NEUTRAL (ignored for avoidance) if:
    //   1. Just logged without rating or like - we don't know user's opinion!
    //   2. Rated 2-2.5 stars - ambiguous "meh" zone, not a strong signal
    //   3. Rating is 0 - this means "no rating" in Letterboxd exports
    
    const DISLIKE_THRESHOLD = 1.5; // Only 0.5-1.5 stars counts as "disliked"
    
    // Helper to check if rating is a real rating (not null/0 which means "no rating")
    const hasRealRating = (rating: number | null | undefined): boolean => {
      return rating != null && rating > 0;
    };
    
    // Films that are liked (explicit like OR positive rating >= 3)
    const likedFilmsForAvoidance = filteredFilms.filter(f => 
      f.liked || (hasRealRating(f.rating) && f.rating! >= 3)
    );

    // Films that are disliked (very low rating 0.5-1.5 AND not liked)
    // CRITICAL: rating must be > 0 (real rating) AND <= 1.5
    // rating = 0 means "no rating" not "0 stars"!
    const dislikedFilms = filteredFilms.filter(f => 
      hasRealRating(f.rating) && f.rating! <= DISLIKE_THRESHOLD && !f.liked
    );

    // Films that are neutral (logged without strong signal)
    const neutralFilms = filteredFilms.filter(f => 
      (!hasRealRating(f.rating) && !f.liked) || // Unrated (null or 0) and not liked
      (hasRealRating(f.rating) && f.rating! > DISLIKE_THRESHOLD && f.rating! < 3 && !f.liked) // 2-2.5 star zone
    );

    console.log('[AvoidanceProfile] Film categorization:', {
      totalWatched: filteredFilms.length,
      likedCount: likedFilmsForAvoidance.length,
      dislikedCount: dislikedFilms.length,
      neutralCount: neutralFilms.length,
      dislikeThreshold: DISLIKE_THRESHOLD,
      filmsWithRating0: filteredFilms.filter(f => f.rating === 0).length,
      note: 'rating=0 means "no rating" (same as null), not "0 stars"'
    });

    // Count LIKED occurrences
    for (const film of likedFilmsForAvoidance) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (!details) continue;

      details.genres?.forEach(genre => {
        genreLikedCount.set(genre.name, (genreLikedCount.get(genre.name) || 0) + 1);
      });

      const keywords = (details as any).keywords?.keywords || (details as any).keywords?.results || [];
      keywords.forEach((k: { name: string }) => {
        keywordLikedCount.set(k.name, (keywordLikedCount.get(k.name) || 0) + 1);
      });

      details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
        directorLikedCount.set(director.name, (directorLikedCount.get(director.name) || 0) + 1);
      });
    }

    // Count DISLIKED occurrences
    for (const film of dislikedFilms) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (!details) continue;

      details.genres?.forEach(genre => {
        genreDislikedCount.set(genre.name, (genreDislikedCount.get(genre.name) || 0) + 1);
      });

      const keywords = (details as any).keywords?.keywords || (details as any).keywords?.results || [];
      keywords.forEach((k: { name: string }) => {
        keywordDislikedCount.set(k.name, (keywordDislikedCount.get(k.name) || 0) + 1);
      });

      details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
        directorDislikedCount.set(director.name, (directorDislikedCount.get(director.name) || 0) + 1);
      });
    }

    // Only avoid if: disliked > liked AND disliked >= minimum threshold
    // This means user has a NET NEGATIVE experience with this item
    const MIN_DISLIKED_FOR_AVOIDANCE = 3;
    const MIN_DISLIKE_RATIO = 0.6; // Must dislike 60%+ of films with this attribute

    const avoidedGenres = Array.from(genreDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = genreLikedCount.get(name) || 0;
        const total = liked + disliked;
        const dislikeRatio = disliked / total;
        // Avoid only if: 3+ disliked AND dislike ratio > 60%
        return disliked >= MIN_DISLIKED_FOR_AVOIDANCE && dislikeRatio >= MIN_DISLIKE_RATIO;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, disliked]) => {
        const liked = genreLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    const avoidedKeywords = Array.from(keywordDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = keywordLikedCount.get(name) || 0;
        const total = liked + disliked;
        const dislikeRatio = disliked / total;
        // Avoid only if: 2+ disliked AND dislike ratio > 60%
        return disliked >= 2 && dislikeRatio >= MIN_DISLIKE_RATIO;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, disliked]) => {
        const liked = keywordLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    const avoidedDirectors = Array.from(directorDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = directorLikedCount.get(name) || 0;
        const total = liked + disliked;
        const dislikeRatio = disliked / total;
        // Avoid only if: 2+ disliked AND dislike ratio > 60%
        return disliked >= 2 && dislikeRatio >= MIN_DISLIKE_RATIO;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, disliked]) => {
        const liked = directorLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    // Track items that WOULD be avoided by count alone but user actually likes them
    // (disliked >= threshold but liked MORE than disliked)
    const mixedGenres = Array.from(genreDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = genreLikedCount.get(name) || 0;
        // Has significant dislikes but user likes them overall
        return disliked >= MIN_DISLIKED_FOR_AVOIDANCE && liked > disliked;
      })
      .map(([name, disliked]) => {
        const liked = genreLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    const mixedDirectors = Array.from(directorDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = directorLikedCount.get(name) || 0;
        return disliked >= 2 && liked > disliked;
      })
      .map(([name, disliked]) => {
        const liked = directorLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    const mixedKeywords = Array.from(keywordDislikedCount.entries())
      .filter(([name, disliked]) => {
        const liked = keywordLikedCount.get(name) || 0;
        return disliked >= 2 && liked > disliked;
      })
      .slice(0, 15)
      .map(([name, disliked]) => {
        const liked = keywordLikedCount.get(name) || 0;
        return { name, dislikedCount: disliked, likedCount: liked };
      });

    // === WATCHLIST ANALYSIS ===
    // Watchlist shows user INTENT - what they WANT to watch
    // This is a strong positive signal for taste profile and should override avoidance
    const watchlistGenreCounts = new Map<string, number>();
    const watchlistKeywordCounts = new Map<string, number>();
    const watchlistDirectorCounts = new Map<string, number>();
    const watchlistActorCounts = new Map<string, number>();
    
    for (const film of watchlist) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (!details) continue;

      // Track genres user WANTS to see
      details.genres?.forEach(genre => {
        watchlistGenreCounts.set(genre.name, (watchlistGenreCounts.get(genre.name) || 0) + 1);
      });

      // Track keywords/themes user WANTS to see
      const keywords = (details as any).keywords?.keywords || (details as any).keywords?.results || [];
      keywords.forEach((k: { name: string }) => {
        watchlistKeywordCounts.set(k.name, (watchlistKeywordCounts.get(k.name) || 0) + 1);
      });

      // Track directors user WANTS to see
      details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
        watchlistDirectorCounts.set(director.name, (watchlistDirectorCounts.get(director.name) || 0) + 1);
      });

      // Track actors user WANTS to see
      details.credits?.cast?.slice(0, 5).forEach(actor => {
        watchlistActorCounts.set(actor.name, (watchlistActorCounts.get(actor.name) || 0) + 1);
      });
    }

    // Get top items from watchlist (showing user's intent)
    const watchlistTopGenres = Array.from(watchlistGenreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const watchlistTopKeywords = Array.from(watchlistKeywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    const watchlistTopDirectors = Array.from(watchlistDirectorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const watchlistTopActors = Array.from(watchlistActorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Find items that would be avoided but user has them on watchlist (override signal)
    const avoidanceOverrides = {
      genres: avoidedGenres.filter(g => watchlistGenreCounts.has(g.name))
        .map(g => ({ ...g, watchlistCount: watchlistGenreCounts.get(g.name) || 0 })),
      keywords: avoidedKeywords.filter(k => watchlistKeywordCounts.has(k.name))
        .map(k => ({ ...k, watchlistCount: watchlistKeywordCounts.get(k.name) || 0 })),
      directors: avoidedDirectors.filter(d => watchlistDirectorCounts.has(d.name))
        .map(d => ({ ...d, watchlistCount: watchlistDirectorCounts.get(d.name) || 0 })),
    };

    // Categorize studios (indie vs major)
    const indieStudios = ['A24', 'Neon', 'Annapurna Pictures', 'Focus Features', 'Blumhouse Productions',
      'Studio Ghibli', 'Searchlight Pictures', 'Fox Searchlight Pictures', 'IFC Films',
      'Magnolia Pictures', 'Miramax', '24 Frames', 'Plan B Entertainment', 'Participant'];
    const majorStudios = ['Warner Bros.', 'Universal Pictures', 'Paramount Pictures', '20th Century Fox',
      'Columbia Pictures', 'Walt Disney Pictures', 'Sony Pictures', 'Metro-Goldwyn-Mayer',
      'Lionsgate', 'New Line Cinema', 'DreamWorks', 'Legendary Pictures'];

    let indieWeight = 0;
    let majorWeight = 0;

    for (const [studio, weight] of studioWeights.entries()) {
      if (indieStudios.some(indie => studio.includes(indie))) {
        indieWeight += weight;
      } else if (majorStudios.some(major => studio.includes(major))) {
        majorWeight += weight;
      }
    }

    const studioPreference = {
      indie: indieWeight,
      major: majorWeight,
      total: indieWeight + majorWeight
    };

    // Decade preferences (weighted)
    const decadeWeights = new Map<string, number>();
    for (const film of filteredFilms) {
      if (film.year != null) {
        const decade = `${Math.floor(film.year / 10) * 10}s`;
        const weight = getEnhancedWeight(film);
        decadeWeights.set(decade, (decadeWeights.get(decade) ?? 0) + weight);
      }
    }
    const topDecades = Array.from(decadeWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Language preferences (weighted)
    const languageWeights = new Map<string, number>();
    for (const film of filteredFilms) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (details) {
        const lang = (details as any).original_language;
        if (lang) {
          const weight = getEnhancedWeight(film);
          languageWeights.set(lang, (languageWeights.get(lang) ?? 0) + weight);
        }
      }
    }
    const topLanguages = Array.from(languageWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Runtime analysis
    const runtimes: number[] = [];
    for (const film of filteredFilms) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (details) {
        const runtime = (details as any).runtime;
        if (runtime && runtime > 0) {
          runtimes.push(runtime);
        }
      }
    }
    const runtimeStats = runtimes.length > 0 ? {
      min: Math.min(...runtimes),
      max: Math.max(...runtimes),
      avg: runtimes.reduce((sum, r) => sum + r, 0) / runtimes.length
    } : null;

    // Seasonal information
    const now = new Date();
    const month = now.getMonth();
    let currentSeason = 'Winter';
    let seasonalGenres: string[] = [];

    if (month >= 2 && month <= 4) {
      currentSeason = 'Spring';
      seasonalGenres = ['Romance', 'Drama', 'Documentary'];
    } else if (month >= 5 && month <= 7) {
      currentSeason = 'Summer';
      seasonalGenres = ['Action', 'Adventure', 'Comedy'];
    } else if (month >= 8 && month <= 10) {
      currentSeason = 'Fall';
      seasonalGenres = ['Horror', 'Thriller', 'Mystery'];
    } else {
      currentSeason = 'Winter';
      seasonalGenres = ['Drama', 'Family', 'Animation'];
    }

    return {
      totalFilms: films?.length ?? 0,
      watchedCount: filteredFilms.length,
      watchlistCount: watchlist.length,
      ratedCount: rated.length,
      rewatchedCount: rewatched.length,
      likedCount: liked.length,
      avgRating,
      totalWatches,
      totalRewatchEntries,
      mostWatched,
      ratingsBuckets,
      years,
      yearCounts,
      decades,
      decadeCounts,
      topGenres,
      topGenresByWeight,
      topActors,
      topActorsByWeight,
      topDirectors,
      topDirectorsByWeight,
      topKeywords,
      topStudios,
      studioPreference,
      absoluteFavorites: absoluteFavorites.length,
      highlyRatedCount: highlyRated.length,
      lowRatedButLikedCount: lowRatedButLiked.length,
      topDecades,
      topLanguages,
      runtimeStats,
      currentSeason,
      seasonalGenres,
      // Avoidance data - now based on liked vs disliked ratio
      dislikedFilmsCount: dislikedFilms.length,
      likedFilmsCount: likedFilmsForAvoidance.length,
      avoidedGenres,
      avoidedKeywords,
      avoidedDirectors,
      // Mixed feelings - user has both liked AND disliked but overall positive
      mixedGenres,
      mixedDirectors,
      mixedKeywords,
      // Watchlist analysis - user intent signals
      watchlistTopGenres,
      watchlistTopKeywords,
      watchlistTopDirectors,
      watchlistTopActors,
      avoidanceOverrides,
    };
  }, [filteredFilms, tmdbDetails, films, filmMappings]);

  // Log taste profile build details for debugging
  useEffect(() => {
    if (!stats) return;
    
    console.log('=== TASTE PROFILE BUILD DEBUG ===');
    console.log('[TasteProfile] Input data:', {
      filteredFilmsCount: filteredFilms.length,
      tmdbDetailsCount: tmdbDetails.size,
      filmMappingsCount: filmMappings.size,
      mappingCoverage: mappingCoverage,
    });
    
    console.log('[TasteProfile] Genre Analysis:', {
      topGenresByWeight: stats.topGenresByWeight,
      topGenresRaw: stats.topGenres,
    });
    
    console.log('[TasteProfile] Directors:', {
      topDirectorsByWeight: stats.topDirectorsByWeight,
      topDirectorsRaw: stats.topDirectors,
    });
    
    console.log('[TasteProfile] Actors:', {
      topActorsByWeight: stats.topActorsByWeight,
      topActorsRaw: stats.topActors,
    });
    
    console.log('[TasteProfile] Keywords/Themes:', {
      topKeywords: stats.topKeywords,
    });
    
    console.log('[TasteProfile] Studios:', {
      topStudios: stats.topStudios,
      studioPreference: stats.studioPreference,
    });
    
    console.log('[TasteProfile] Era/Decade Preferences:', {
      topDecades: stats.topDecades,
    });
    
    console.log('[TasteProfile] Other Stats:', {
      avgRating: stats.avgRating,
      rewatchedCount: stats.rewatchedCount,
      likedCount: stats.likedCount,
      absoluteFavorites: stats.absoluteFavorites,
      runtimeStats: stats.runtimeStats,
    });
    
    // Check if taste profile will show
    const willShowTasteProfile = stats.topGenresByWeight.length > 0;
    console.log('[TasteProfile] Will show Taste Profile section:', willShowTasteProfile);
    if (!willShowTasteProfile) {
      console.warn('[TasteProfile] ⚠️ Taste Profile will NOT show - no genre data!');
      console.warn('[TasteProfile] Possible causes:');
      console.warn('  1. TMDB enrichment failed (check for 401 errors)');
      console.warn('  2. No film_tmdb_map entries for user');
      console.warn('  3. tmdb_movies cache is empty');
    }
    console.log('=== END TASTE PROFILE DEBUG ===');
  }, [stats, filteredFilms.length, tmdbDetails.size, filmMappings.size, mappingCoverage]);

  if (loading) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <p className="text-gray-600">Loading your stats...</p>
      </AuthGate>
    );
  }

  if (!stats) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <p className="text-gray-600">No data yet. Import your Letterboxd data to see stats.</p>
      </AuthGate>
    );
  }

  const ratingsOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['0★', '½★', '1★', '1½★', '2★', '2½★', '3★', '3½★', '4★', '4½★', '5★'] },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: stats.ratingsBuckets,
      itemStyle: { color: '#10b981' }
    }],
  };

  const byYearOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: stats.years,
      axisLabel: { interval: Math.floor(stats.years.length / 10) || 0 }
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: stats.yearCounts,
      smooth: true,
      itemStyle: { color: '#3b82f6' },
      areaStyle: { opacity: 0.3 }
    }],
  };

  const byDecadeOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: stats.decades },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: stats.decadeCounts,
      itemStyle: { color: '#8b5cf6' }
    }],
  };

  const genreOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: stats.topGenres.map(([name, count]) => ({ value: count, name })),
      label: { show: true },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  };

  return (
    <AuthGate>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Your Movie Stats</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setTimeFilter('all')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All Time
          </button>
          <button
            onClick={() => setTimeFilter('year')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            This Year
          </button>
          <button
            onClick={() => setTimeFilter('month')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            This Month
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Films Watched</p>
          <p className="text-2xl font-bold text-gray-900">{stats.watchedCount}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Total Watches</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalWatches}</p>
          {stats.rewatchedCount > 0 && (
            <p className="text-xs text-gray-500 mt-1">{stats.rewatchedCount} rewatched</p>
          )}
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Average Rating</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avgRating}★</p>
          <p className="text-xs text-gray-500 mt-1">{stats.ratedCount} rated</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">On Watchlist</p>
          <p className="text-2xl font-bold text-gray-900">{stats.watchlistCount}</p>
        </div>
      </div>

      {/* Enrichment Warning - show if less than 50% of films are mapped */}
      {mappingCoverage && mappingCoverage.mapped < mappingCoverage.total * 0.5 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-medium text-amber-800">Incomplete Film Enrichment</h3>
              <p className="text-sm text-amber-700 mt-1">
                Only {mappingCoverage.mapped} of {mappingCoverage.total} films ({Math.round(mappingCoverage.mapped / mappingCoverage.total * 100)}%) 
                have TMDB data. This affects Taste Profile, Suggestions, and detailed stats.
              </p>
              <p className="text-sm text-amber-700 mt-1">
                <a href="/import" className="underline font-medium">Re-import your data</a> to complete enrichment and unlock full features.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Taste Profile - Weighted Preferences (Powers Suggestions) */}
      {!loadingDetails && stats.topGenresByWeight.length > 0 && (
        <>
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-lg">🎯 Your Taste Profile</h2>
              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">Powers Suggestions</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              These weighted preferences drive your movie suggestions. Higher weights mean stronger influence.
            </p>

            {/* Preference Strength Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Absolute Favorites</p>
                <p className="text-xl font-bold text-gray-900">{stats.absoluteFavorites}</p>
                <p className="text-xs text-gray-500">5★ + Liked (2.0x)</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Highly Rated</p>
                <p className="text-xl font-bold text-gray-900">{stats.highlyRatedCount}</p>
                <p className="text-xs text-gray-500">4★+ films</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Liked Films</p>
                <p className="text-xl font-bold text-gray-900">{stats.likedCount}</p>
                <p className="text-xs text-gray-500">All liked</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Guilty Pleasures</p>
                <p className="text-xl font-bold text-gray-900">{stats.lowRatedButLikedCount}</p>
                <p className="text-xs text-gray-500">&lt;3★ but liked</p>
              </div>
            </div>

            {/* Top Genres by Weight */}
            <div className="mb-4">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Top Genre Preferences (Weighted)</h3>
              <div className="flex flex-wrap gap-2">
                {stats.topGenresByWeight.slice(0, 8).map(([genre, weight]) => {
                  const strength = weight >= 3.0 ? 'strong' : weight >= 1.5 ? 'moderate' : 'light';
                  const colorClass = strength === 'strong' ? 'bg-green-600 text-white' : strength === 'moderate' ? 'bg-green-400 text-white' : 'bg-green-200 text-green-900';
                  return (
                    <span key={genre} className={`px-3 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                      {genre} ({weight.toFixed(1)})
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Top Keywords/Themes */}
            {stats.topKeywords.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Top Themes & Keywords (Weighted)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topKeywords.slice(0, 12).map(([keyword, weight]) => {
                    const strength = weight >= 3.0 ? 'strong' : weight >= 1.5 ? 'moderate' : 'light';
                    const colorClass = strength === 'strong' ? 'bg-emerald-600 text-white' : strength === 'moderate' ? 'bg-emerald-400 text-white' : 'bg-emerald-200 text-emerald-900';
                    return (
                      <span key={keyword} className={`px-3 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                        {keyword} ({weight.toFixed(1)})
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top Directors by Weight */}
            {stats.topDirectorsByWeight.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Directors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topDirectorsByWeight.map(({ name, weight, count }) => (
                    <span key={name} className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500 text-white">
                      {name} ({weight.toFixed(1)} across {count} films)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top Actors by Weight */}
            {stats.topActorsByWeight.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Actors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topActorsByWeight.map(({ name, weight, count }) => (
                    <span key={name} className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500 text-white">
                      {name} ({weight.toFixed(1)} across {count} films)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Studio Preferences */}
            {stats.topStudios.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2 text-sm flex items-center gap-2">
                  <span>🎬</span>
                  <span>Favorite Studios</span>
                </h3>
                <p className="text-xs text-gray-600 mb-2">Production companies whose films resonate with you</p>

                {/* Indie vs Major breakdown */}
                {stats.studioPreference.total > 0 && (
                  <div className="mb-3 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-gray-700">Studio Type Preference:</span>
                    </div>
                    <div className="flex gap-2 h-8">
                      <div
                        className="bg-orange-500 flex items-center justify-center text-white text-xs font-medium rounded transition-all"
                        style={{ width: `${(stats.studioPreference.indie / stats.studioPreference.total) * 100}%` }}
                      >
                        {stats.studioPreference.indie > 0 && `Indie ${stats.studioPreference.indie.toFixed(1)}`}
                      </div>
                      <div
                        className="bg-blue-500 flex items-center justify-center text-white text-xs font-medium rounded transition-all"
                        style={{ width: `${(stats.studioPreference.major / stats.studioPreference.total) * 100}%` }}
                      >
                        {stats.studioPreference.major > 0 && `Major ${stats.studioPreference.major.toFixed(1)}`}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {stats.topStudios.slice(0, 10).map(([studio, weight]) => {
                    return (
                      <span key={studio} className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500 text-white">
                        {studio} ({weight.toFixed(1)})
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Additional Taste Insights - Informational Only */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Era Preferences */}
            {stats.topDecades && stats.topDecades.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>📅</span>
                  <span>Preferred Film Eras</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Decades you&apos;ve watched most. Not used to limit suggestions—we&apos;ll recommend great films from any era!</p>
                <div className="space-y-2">
                  {stats.topDecades.map(([decade, weight]) => {
                    const percentage = (weight / stats.topDecades[0][1]) * 100;
                    return (
                      <div key={decade} className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 w-16">{decade}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                          <div
                            className="bg-indigo-500 h-full rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-900">
                            {weight.toFixed(1)} weight
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Language Preferences */}
            {stats.topLanguages && stats.topLanguages.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🌍</span>
                  <span>Language Preferences</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Languages you&apos;ve watched most. Not used to limit suggestions—we&apos;ll recommend films in any language!</p>
                <div className="space-y-2">
                  {stats.topLanguages.map(([lang, weight]) => {
                    const langNames: Record<string, string> = {
                      'en': 'English', 'fr': 'French', 'es': 'Spanish', 'de': 'German',
                      'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                      'pt': 'Portuguese', 'ru': 'Russian', 'hi': 'Hindi', 'ar': 'Arabic'
                    };
                    const displayName = langNames[lang] || lang.toUpperCase();
                    const percentage = (weight / stats.topLanguages[0][1]) * 100;
                    return (
                      <div key={lang} className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 w-20">{displayName}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                          <div
                            className="bg-teal-500 h-full rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-900">
                            {weight.toFixed(1)} weight
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Runtime Preferences */}
            {stats.runtimeStats && stats.runtimeStats.avg > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>⏱️</span>
                  <span>Runtime Sweet Spot</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Your typical film length. Not used to limit suggestions—we&apos;ll recommend films of any runtime!</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{Math.round(stats.runtimeStats.min)}</p>
                    <p className="text-xs text-gray-500">Min (mins)</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-indigo-600">{Math.round(stats.runtimeStats.avg)}</p>
                    <p className="text-xs text-gray-500">Average</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{Math.round(stats.runtimeStats.max)}</p>
                    <p className="text-xs text-gray-500">Max (mins)</p>
                  </div>
                </div>
              </div>
            )}

            {/* Seasonal Preferences */}
            {stats.currentSeason && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🍂</span>
                  <span>Seasonal Context</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Current season for context. Not used to limit suggestions—we recommend all types year-round!</p>
                <div className="bg-gradient-to-r from-orange-100 to-amber-100 rounded-lg p-3">
                  <p className="text-lg font-bold text-gray-900 mb-1">{stats.currentSeason}</p>
                  <p className="text-xs text-gray-700 mb-2">Typical seasonal genres (for reference only)</p>
                  {stats.seasonalGenres && stats.seasonalGenres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {stats.seasonalGenres.map((genre) => (
                        <span key={genre} className="px-2 py-1 bg-amber-200 text-amber-900 rounded text-xs font-medium">
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Most Watched Film */}
      {stats.mostWatched && (stats.mostWatched.watchCount ?? 0) > 1 && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-purple-900 mb-1">Most Watched Film</p>
          <p className="text-lg font-bold text-purple-900">
            {stats.mostWatched.title} {stats.mostWatched.year && `(${stats.mostWatched.year})`}
          </p>
          <p className="text-sm text-purple-700">Watched {stats.mostWatched.watchCount} times</p>
        </div>
      )}

      {/* Top People & Genres */}
      {loadingDetails ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">Loading detailed stats (actors, directors, genres)...</p>
          <p className="text-xs text-blue-600 mt-1">This may take a moment for large libraries.</p>
        </div>
      ) : detailsError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800 font-medium">Error loading detailed stats</p>
          <p className="text-xs text-red-600 mt-1">{detailsError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Refresh Page
          </button>
        </div>
      ) : (
        <>
          {stats.topActors.length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3">Top Actors</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {stats.topActors.map(([name, data]) => (
                  <div key={name} className="text-center">
                    <div className="w-20 h-20 mx-auto mb-2 rounded-full overflow-hidden bg-gray-200">
                      {data.profile ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${data.profile}`}
                          alt={name}
                          width={80}
                          height={80}
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          No photo
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-500">{data.count} films</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.topDirectors.length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3">Top Directors</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {stats.topDirectors.map(([name, data]) => (
                  <div key={name} className="text-center">
                    <div className="w-20 h-20 mx-auto mb-2 rounded-full overflow-hidden bg-gray-200">
                      {data.profile ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${data.profile}`}
                          alt={name}
                          width={80}
                          height={80}
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          No photo
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-500">{data.count} films</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Algorithm Insights Section - Phase 5+ Transparency */}
      {stats && (
        <div className="bg-white border rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            📊 Algorithm Insights
            <span className="text-xs text-gray-500 font-normal">
              (How your behavior influences recommendations)
            </span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-50 rounded p-3">
              <div className="text-sm text-gray-600">Rewatch Rate</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.totalRewatchEntries && stats.totalWatches ?
                  ((stats.totalRewatchEntries / stats.totalWatches) * 100).toFixed(1) : '0.0'}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Rewatched films get 1.8x boost in similar suggestions
              </div>
            </div>

            <div className="bg-purple-50 rounded p-3">
              <div className="text-sm text-gray-600">Liked Films</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.likedCount?.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Liked films receive 1.5-2.0x weight in taste profile
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Watchlist Analysis Section - What the user WANTS to see */}
      {stats && !loadingDetails && stats.watchlistCount > 0 && (stats.watchlistTopGenres?.length > 0 || stats.watchlistTopDirectors?.length > 0) && (
        <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-lg">📋 What You Want to Watch</h2>
            <span className="text-xs text-cyan-700 bg-cyan-100 px-2 py-1 rounded">{stats.watchlistCount} films on watchlist</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Your watchlist shows what you&apos;re interested in — this signals positive intent to the recommendation algorithm.
          </p>

          {/* Avoidance Overrides - items on watchlist that would otherwise be avoided */}
          {stats.avoidanceOverrides && (stats.avoidanceOverrides.genres.length > 0 || stats.avoidanceOverrides.keywords.length > 0 || stats.avoidanceOverrides.directors.length > 0) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <h3 className="font-medium text-green-900 mb-2 text-sm flex items-center gap-2">
                ✓ Avoidance Overrides
              </h3>
              <p className="text-xs text-green-700 mb-3">
                These would be avoided based on ratings, but your watchlist shows interest — they won&apos;t be filtered out:
              </p>
              
              {stats.avoidanceOverrides.genres.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Genres: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.genres.map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800">
                        {name} <span className="text-green-600">({watchlistCount} on watchlist)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {stats.avoidanceOverrides.directors.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Directors: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.directors.map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-blue-200 text-blue-800">
                        {name} <span className="text-blue-600">({watchlistCount} on watchlist)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {stats.avoidanceOverrides.keywords.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-green-800">Themes: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.keywords.slice(0, 8).map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-emerald-200 text-emerald-800">
                        {name} ({watchlistCount} on watchlist)
                      </span>
                    ))}
                    {stats.avoidanceOverrides.keywords.length > 8 && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600">
                        +{stats.avoidanceOverrides.keywords.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Watchlist Genres */}
            {stats.watchlistTopGenres && stats.watchlistTopGenres.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Genres You Want</h3>
                <div className="flex flex-wrap gap-1">
                  {stats.watchlistTopGenres.slice(0, 8).map(({ name, count }) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-cyan-100 text-cyan-700">
                      {name} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Directors */}
            {stats.watchlistTopDirectors && stats.watchlistTopDirectors.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Directors You Want</h3>
                <div className="space-y-1">
                  {stats.watchlistTopDirectors.slice(0, 6).map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{name}</span>
                      <span className="text-xs text-cyan-600">{count} films</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Actors */}
            {stats.watchlistTopActors && stats.watchlistTopActors.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Actors You Want</h3>
                <div className="space-y-1">
                  {stats.watchlistTopActors.slice(0, 6).map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{name}</span>
                      <span className="text-xs text-cyan-600">{count} films</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Keywords */}
            {stats.watchlistTopKeywords && stats.watchlistTopKeywords.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Themes You Want</h3>
                <div className="flex flex-wrap gap-1">
                  {stats.watchlistTopKeywords.slice(0, 10).map(({ name, count }) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">
                      {name} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-4">
            💡 Your watchlist helps discover what you want — these patterns boost matching recommendations and can override negative signals.
          </p>
        </div>
      )}

      {/* Avoidance Profile Section - What we're filtering out */}
      {stats && !loadingDetails && (stats.avoidedGenres?.length > 0 || stats.avoidedKeywords?.length > 0 || stats.avoidedDirectors?.length > 0 || stats.mixedGenres?.length > 0 || stats.mixedKeywords?.length > 0 || stats.mixedDirectors?.length > 0) && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-lg">🚫 Avoidance Profile</h2>
            <span className="text-xs text-red-700 bg-red-100 px-2 py-1 rounded">Filters Suggestions</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Comparing {stats.likedFilmsCount} liked films (3+ stars or ❤️) vs {stats.dislikedFilmsCount} disliked films (≤1.5 stars).
            <strong> Only avoided if you dislike 60%+ of films with that attribute.</strong>
            <br />
            <span className="text-xs text-gray-500">Note: Films rated 2-2.5 stars are &quot;meh&quot; (neutral) and don&apos;t count as dislikes. Unrated films are also neutral.</span>
          </p>

          {/* Mixed Feelings Section - Things user has mixed feelings about */}
          {((stats.mixedGenres && stats.mixedGenres.length > 0) || 
            (stats.mixedDirectors && stats.mixedDirectors.length > 0) || 
            (stats.mixedKeywords && stats.mixedKeywords.length > 0)) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <h3 className="font-medium text-green-900 mb-2 text-sm flex items-center gap-2">
                ✓ Mixed Feelings (Not Avoided)
              </h3>
              <p className="text-xs text-green-700 mb-3">
                You&apos;ve disliked some films with these, but you&apos;ve liked MORE — so they&apos;re not avoided:
              </p>
              
              {/* Mixed Genres */}
              {stats.mixedGenres && stats.mixedGenres.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Genres: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.mixedGenres.map(({ name, likedCount, dislikedCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800">
                        {name} <span className="text-green-600">({likedCount}👍 vs {dislikedCount}👎)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Mixed Directors */}
              {stats.mixedDirectors && stats.mixedDirectors.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Directors: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.mixedDirectors.map(({ name, likedCount, dislikedCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-blue-200 text-blue-800">
                        {name} <span className="text-blue-600">({likedCount}👍 vs {dislikedCount}👎)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Mixed Keywords */}
              {stats.mixedKeywords && stats.mixedKeywords.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-green-800">Themes: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.mixedKeywords.slice(0, 10).map(({ name, likedCount, dislikedCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-emerald-200 text-emerald-800">
                        {name} ({likedCount}👍 vs {dislikedCount}👎)
                      </span>
                    ))}
                    {stats.mixedKeywords.length > 10 && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600">
                        +{stats.mixedKeywords.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4">
            {/* Avoided Genres */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Genres</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedGenres && stats.avoidedGenres.length > 0 ? (
                <div className="space-y-2">
                  {stats.avoidedGenres.map(({ name, likedCount, dislikedCount }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-red-700">{name}</span>
                      <span className="text-xs text-gray-500">{dislikedCount}👎 vs {likedCount}👍</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No genres being avoided</p>
              )}
            </div>

            {/* Avoided Keywords/Themes */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Themes</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedKeywords && stats.avoidedKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {stats.avoidedKeywords.map(({ name, likedCount, dislikedCount }) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-red-100 text-red-700">
                      {name} ({dislikedCount}👎/{likedCount}👍)
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No themes being avoided</p>
              )}
            </div>

            {/* Avoided Directors */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Directors</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedDirectors && stats.avoidedDirectors.length > 0 ? (
                <div className="space-y-2">
                  {stats.avoidedDirectors.map(({ name, likedCount, dislikedCount }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-red-700">{name}</span>
                      <span className="text-xs text-gray-500">{dislikedCount}👎 vs {likedCount}👍</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No directors being avoided</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-4">
            💡 &quot;Disliked&quot; = rated ≤1.5 stars. Films rated 2+ stars are not considered dislikes.
            &quot;Guilty pleasures&quot; (low-rated but ❤️ liked) don&apos;t count as dislikes either.
            Films just logged without a rating are neutral.
          </p>
        </div>
      )}

      {/* Discovery Preferences Section - Phase 5+ Adaptive Learning */}
      {explorationStats && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            🔍 Your Discovery Preferences
            <span className="text-xs text-indigo-600 font-normal">
              (Adaptive Learning Active)
            </span>
          </h2>

          <div className="space-y-3">
            <div className="bg-white rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-900">Current Exploration Rate</div>
                <div className="text-lg font-bold text-indigo-600">
                  {(explorationStats.exploration_rate * 100).toFixed(0)}%
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${explorationStats.exploration_rate * 3.33 * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-600 mt-2">
                {explorationStats.exploration_rate !== 0.15 ? (
                  explorationStats.exploration_rate > 0.15 ? (
                    <span className="text-green-700">
                      ✓ Increased because you enjoy exploratory picks (avg {explorationStats.exploratory_avg_rating.toFixed(1)}★)
                    </span>
                  ) : (
                    <span className="text-orange-700">
                      ↓ Decreased to focus on safer recommendations (avg {explorationStats.exploratory_avg_rating.toFixed(1)}★)
                    </span>
                  )
                ) : (
                  <span>
                    Default rate • Will adjust based on your ratings ({explorationStats.exploratory_films_rated} exploratory films rated so far)
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-600 bg-white rounded p-2">
              <strong>What this means:</strong> {(explorationStats.exploration_rate * 100).toFixed(0)}% of your suggestions
              will be &quot;discovery picks&quot; from adjacent genres or acclaimed films outside your usual taste.
              The other {(100 - explorationStats.exploration_rate * 100).toFixed(0)}% are high-confidence matches.
            </div>

            {/* Learned Adjacencies */}
            {adjacentPrefs.length > 0 && (
              <div className="bg-white rounded p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">
                  Learned Genre Transitions
                </div>
                <div className="space-y-1">
                  {adjacentPrefs.slice(0, 5).map((pref, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700">
                        {pref.from_genre_name} → {pref.to_genre_name}
                      </span>
                      <span className="text-green-700 font-medium">
                        {(pref.success_rate * 100).toFixed(0)}% success ({pref.rating_count} films)
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Algorithm learned which genre combinations you enjoy!
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-6">
        {stats.topGenres.length > 0 && (
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Top Genres</h2>
            <Chart option={genreOption} />
          </div>
        )}

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Ratings Distribution</h2>
          <Chart option={ratingsOption} />
        </div>

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Films by Release Year</h2>
          <Chart option={byYearOption} />
        </div>

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Films by Decade</h2>
          <Chart option={byDecadeOption} />
        </div>


      </div>
    </AuthGate>
  );
}
