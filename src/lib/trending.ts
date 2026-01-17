import {
  getCachedTraktRelated,
  setCachedTraktRelated,
  getCachedTMDBSimilar,
  setCachedTMDBSimilar,
} from "./apiCache";

/**
 * Helper to get the base URL for internal API calls
 * Works correctly in both browser (client) and server (Server Actions) contexts
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  // Server-side: use env var or default to localhost:3000
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/**
 * Genre adjacency map for exploration vs exploitation
 * Maps each genre to related genres for gentle discovery expansion
 */
const ADJACENT_GENRES: Record<number, number[]> = {
  // Thriller (53) -> Mystery, Crime, Horror, Action
  53: [9648, 80, 27, 28],

  // Drama (18) -> Romance, History, War
  18: [10749, 36, 10752],

  // Action (28) -> Adventure, Sci-Fi, War, Thriller
  28: [12, 878, 10752, 53],

  // Comedy (35) -> Romance, Family, Animation
  35: [10749, 10751, 16],

  // Sci-Fi (878) -> Fantasy, Adventure, Thriller, Mystery
  878: [14, 12, 53, 9648],

  // Horror (27) -> Thriller, Mystery, Fantasy
  27: [53, 9648, 14],

  // Romance (10749) -> Drama, Comedy
  10749: [18, 35],

  // Crime (80) -> Thriller, Mystery, Drama
  80: [53, 9648, 18],

  // Mystery (9648) -> Thriller, Crime, Horror
  9648: [53, 80, 27],

  // Fantasy (14) -> Adventure, Sci-Fi, Family
  14: [12, 878, 10751],

  // Adventure (12) -> Action, Fantasy, Family
  12: [28, 14, 10751],

  // Animation (16) -> Family, Fantasy, Comedy, Adventure
  16: [10751, 14, 35, 12],

  // Documentary (99) -> History, War
  99: [36, 10752],

  // Western (37) -> Action, Drama, Adventure
  37: [28, 18, 12],

  // Family (10751) -> Animation, Adventure, Fantasy, Comedy
  10751: [16, 12, 14, 35],

  // History (36) -> Drama, War, Documentary
  36: [18, 10752, 99],

  10752: [28, 18, 36],
};

/**
 * Film data for weighted seed selection
 */
export interface FilmForSeeding {
  uri: string;
  tmdbId: number;
  rating?: number;
  liked?: boolean;
  rewatch?: boolean;
  lastDate?: string;
  genreIds?: number[];
  popularity?: number; // TMDB popularity score (lower = more niche)
  releaseDate?: string; // ISO date string (YYYY-MM-DD)
  title?: string; // Film title for logging
}

/**
 * Signature film score with reasoning
 */
export interface SignatureFilmScore {
  tmdbId: number;
  title: string;
  signatureScore: number;
  reasons: string[];
}

/**
 * Score a film based on how well it represents a user's unique taste
 *
 * A signature film should be:
 * 1. Highly rated by the user (4+ stars or liked)
 * 2. Less mainstream (not in top popularity tiers)
 * 3. Distinctive genres/subgenres that align with user's top preferences
 * 4. Preferably from their preferred decades
 *
 * @param film - The film to score
 * @param profile - User's taste profile with top genres and decades
 * @returns Signature film score with reasoning
 */
export function scoreSignatureFilm(
  film: FilmForSeeding,
  profile: {
    topGenres: Array<{ id: number; name: string }>;
    topDecades?: Array<{ decade: number }>;
  },
): SignatureFilmScore {
  let score = 0;
  const reasons: string[] = [];
  const title = film.title || `Film ${film.tmdbId}`;

  // 1. High user rating (up to 2.0 points)
  if (film.rating !== undefined) {
    if (film.rating >= 4.5) {
      score += 2.0;
      reasons.push("5-star rating");
    } else if (film.rating >= 4.0) {
      score += 1.5;
      reasons.push("4+ star rating");
    }
  }

  if (film.liked) {
    score += 1.0;
    reasons.push("Liked");
  }

  // 2. Niche appeal - inverse popularity (up to 2.0 points)
  // TMDB popularity typically ranges from 0.6 (very obscure) to 5000+ (blockbusters)
  // We want to reward less popular films that the user loved
  if (film.popularity !== undefined) {
    if (film.popularity < 10) {
      score += 2.0;
      reasons.push("Hidden gem (very niche)");
    } else if (film.popularity < 50) {
      score += 1.5;
      reasons.push("Under-the-radar");
    } else if (film.popularity < 200) {
      score += 0.5;
      reasons.push("Less mainstream");
    }
    // No penalty for mainstream - we just don't reward it as much
  }

  // 3. Genre alignment (up to 1.5 points)
  const topGenreNames = profile.topGenres.slice(0, 5).map((g) => g.name);
  const topGenreIds = new Set(profile.topGenres.slice(0, 5).map((g) => g.id));
  const filmGenres = film.genreIds || [];
  const matchingGenres = filmGenres.filter((gid) => topGenreIds.has(gid));

  if (matchingGenres.length >= 2) {
    score += 1.5;
    // Map genre IDs back to names for logging
    const matchedNames = matchingGenres
      .map(
        (gid) =>
          profile.topGenres.find((g) => g.id === gid)?.name || `Genre ${gid}`,
      )
      .slice(0, 2);
    reasons.push(`Multi-genre match: ${matchedNames.join(", ")}`);
  } else if (matchingGenres.length === 1) {
    score += 0.5;
    const genreName =
      profile.topGenres.find((g) => g.id === matchingGenres[0])?.name ||
      `Genre ${matchingGenres[0]}`;
    reasons.push(`Genre: ${genreName}`);
  }

  // 4. Decade alignment (up to 0.5 points)
  if (film.releaseDate && profile.topDecades && profile.topDecades.length > 0) {
    const year = parseInt(film.releaseDate.slice(0, 4));
    if (!isNaN(year)) {
      const decade = Math.floor(year / 10) * 10;
      if (profile.topDecades.some((d) => d.decade === decade)) {
        score += 0.5;
        reasons.push(`Preferred decade: ${decade}s`);
      }
    }
  }

  return { tmdbId: film.tmdbId, title, signatureScore: score, reasons };
}

/**
 * Get seed IDs using signature film detection
 *
 * Identifies films that best represent the user's unique taste by:
 * - Prioritizing highly-rated but less mainstream films
 * - Matching user's preferred genres and decades
 * - Balancing signature picks with some variety
 *
 * @param films - User's films with rating/liked/rewatch/popularity data
 * @param limit - Maximum number of seed IDs to return
 * @param ensureDiversity - If true, ensures seeds come from diverse genres
 * @param profile - User's taste profile with top genres and decades
 * @returns Array of TMDB IDs sorted by signature score
 */
function getSignatureSeedIds(
  films: FilmForSeeding[],
  limit: number,
  ensureDiversity: boolean,
  profile: {
    topGenres: Array<{ id: number; name: string }>;
    topDecades?: Array<{ decade: number }>;
  },
): number[] {
  // Filter to highly-rated or liked films
  const eligibleFilms = films.filter(
    (f) => f.tmdbId && ((f.rating ?? 0) >= 3.5 || f.liked),
  );

  // Score each film as a signature film
  const signatureScored = eligibleFilms
    .map((f) => {
      const sigScore = scoreSignatureFilm(f, profile);
      return {
        ...f,
        signatureScore: sigScore.signatureScore,
        signatureReasons: sigScore.reasons,
      };
    })
    .filter((f) => f.signatureScore > 0) // Only keep films with some signature value
    .sort((a, b) => b.signatureScore - a.signatureScore);

  console.log("[SignatureSeeds] Top signature films:", {
    total: signatureScored.length,
    top10: signatureScored.slice(0, 10).map((f) => ({
      title: f.title || f.tmdbId,
      score: f.signatureScore.toFixed(2),
      reasons: f.signatureReasons.join(", "),
    })),
  });

  // Strategy: Mix top signature films with some variety
  // - 60% from top signature films
  // - 40% from remaining highly-rated films for variety
  const signatureCount = Math.ceil(limit * 0.6);
  const varietyCount = limit - signatureCount;

  const signatureIds = signatureScored
    .slice(0, signatureCount)
    .map((f) => f.tmdbId);

  // Add variety picks from remaining films (shuffle for randomness)
  const remainingFilms = signatureScored.slice(signatureCount);
  const shuffledRemaining = remainingFilms.sort(() => Math.random() - 0.5);
  const varietyIds = shuffledRemaining
    .slice(0, varietyCount)
    .map((f) => f.tmdbId);

  const selectedIds = [...signatureIds, ...varietyIds];

  // Apply genre diversity if requested
  if (ensureDiversity && selectedIds.length > limit) {
    return applyGenreDiversity(films, selectedIds, limit);
  }

  console.log("[SignatureSeeds] Selected seeds:", {
    signature: signatureIds.length,
    variety: varietyIds.length,
    total: selectedIds.length,
    topSignatureScores: signatureScored
      .slice(0, 5)
      .map((f) => f.signatureScore.toFixed(2)),
  });

  return selectedIds.slice(0, limit);
}

/**
 * Apply genre diversity constraints to seed selection
 */
function applyGenreDiversity(
  films: FilmForSeeding[],
  candidateIds: number[],
  limit: number,
): number[] {
  const selectedIds: number[] = [];
  const genreCounts = new Map<number, number>();
  const MAX_PER_GENRE = 4; // Max seeds from same genre

  const filmMap = new Map(films.map((f) => [f.tmdbId, f]));

  for (const id of candidateIds) {
    if (selectedIds.length >= limit) break;

    const film = filmMap.get(id);
    if (!film) continue;

    // Check if we've hit genre cap for any of this film's genres
    const filmGenres = film.genreIds || [];
    const canAdd =
      filmGenres.length === 0 ||
      filmGenres.some((gid) => (genreCounts.get(gid) || 0) < MAX_PER_GENRE);

    if (canAdd) {
      selectedIds.push(id);
      filmGenres.forEach((gid) =>
        genreCounts.set(gid, (genreCounts.get(gid) || 0) + 1),
      );
    }
  }

  // Fill remaining slots if we didn't reach the limit
  if (selectedIds.length < limit) {
    for (const id of candidateIds) {
      if (selectedIds.length >= limit) break;
      if (!selectedIds.includes(id)) {
        selectedIds.push(id);
      }
    }
  }

  return selectedIds;
}

/**
 * Get weighted seed IDs for recommendation APIs
 *
 * This improves on simple "rating >= 4 or liked" filtering by scoring each film:
 * - Higher ratings get more weight (5 stars = 2.0, 4 stars = 1.5)
 * - Liked flag adds weight (even for lower-rated films)
 * - Rewatched films are signature favorites (strong positive signal)
 * - More recent films get recency boost
 * - Ensures genre diversity in seed selection
 * - Optionally uses signature film detection to identify unique taste markers
 *
 * @param films - User's films with rating/liked/rewatch data
 * @param limit - Maximum number of seed IDs to return
 * @param ensureDiversity - If true, ensures seeds come from diverse genres
 * @param profile - Optional taste profile for signature film detection
 */
export function getWeightedSeedIds(
  films: FilmForSeeding[],
  limit: number = 25,
  ensureDiversity: boolean = true,
  profile?: {
    topGenres: Array<{ id: number; name: string }>;
    topDecades?: Array<{ decade: number }>;
    useSignatureScoring?: boolean; // Enable signature film scoring
  },
): number[] {
  // If signature scoring is enabled and we have profile data, use it
  if (profile?.useSignatureScoring && profile.topGenres.length > 0) {
    return getSignatureSeedIds(films, limit, ensureDiversity, profile);
  }

  // Score each film (original weighted scoring)
  const scored = films
    .filter((f) => f.tmdbId && ((f.rating ?? 0) >= 3 || f.liked)) // Basic filter: at least 3 stars or liked
    .map((f) => {
      let score = 0;

      // Rating weight (0-2.0 scale)
      const rating = f.rating ?? 3;
      if (rating >= 4.5)
        score += 2.0; // 5 stars = strongest signal
      else if (rating >= 4)
        score += 1.5; // 4+ stars
      else if (rating >= 3.5)
        score += 1.0; // 3.5+ stars
      else if (rating >= 3) score += 0.5; // 3+ stars

      // Liked flag (even low-rated but liked = positive signal)
      if (f.liked) score += 1.5;

      // Rewatched = signature favorite (strongest signal)
      if (f.rewatch) score += 2.5;

      // Recency boost (within last year = up to +1.0)
      if (f.lastDate) {
        const daysSince = Math.max(
          0,
          (Date.now() - new Date(f.lastDate).getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysSince <= 30)
          score += 1.0; // Last month
        else if (daysSince <= 90)
          score += 0.7; // Last quarter
        else if (daysSince <= 180)
          score += 0.5; // Last 6 months
        else if (daysSince <= 365) score += 0.3; // Last year
      }

      return { ...f, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!ensureDiversity || scored.length <= limit) {
    return scored.slice(0, limit).map((f) => f.tmdbId);
  }

  // Ensure genre diversity: pick top scorers but spread across genres
  const selectedIds: number[] = [];
  const genreCounts = new Map<number, number>();
  const MAX_PER_GENRE = 4; // Max seeds from same genre

  for (const film of scored) {
    if (selectedIds.length >= limit) break;

    // Check if we've hit genre cap for any of this film's genres
    const filmGenres = film.genreIds || [];
    const canAdd =
      filmGenres.length === 0 ||
      filmGenres.some((gid) => (genreCounts.get(gid) || 0) < MAX_PER_GENRE);

    if (canAdd) {
      selectedIds.push(film.tmdbId);
      filmGenres.forEach((gid) =>
        genreCounts.set(gid, (genreCounts.get(gid) || 0) + 1),
      );
    }
  }

  // If we didn't fill the limit due to diversity constraints, add more from top scorers
  if (selectedIds.length < limit) {
    for (const film of scored) {
      if (selectedIds.length >= limit) break;
      if (!selectedIds.includes(film.tmdbId)) {
        selectedIds.push(film.tmdbId);
      }
    }
  }

  console.log("[WeightedSeeds] Selected", {
    input: films.length,
    eligible: scored.length,
    selected: selectedIds.length,
    topScore: scored[0]?.score,
    genreSpread: genreCounts.size,
  });

  return selectedIds;
}

/**
 * Get weighted seed IDs filtered to specific genres
 *
 * Same scoring as getWeightedSeedIds but pre-filters films to only include
 * those that match at least one of the specified genre IDs.
 * Falls back to global seeds if filtered set is too small.
 *
 * @param films - User's films with rating/liked/rewatch/genreIds data
 * @param genreIds - Only include films that have at least one of these genres
 * @param limit - Maximum number of seed IDs to return
 * @param minSeeds - Minimum seeds required before falling back to global (default: 5)
 * @param profile - Optional taste profile for signature film detection
 */
export function getWeightedSeedIdsByGenre(
  films: FilmForSeeding[],
  genreIds: number[],
  limit: number = 25,
  minSeeds: number = 5,
  profile?: {
    topGenres: Array<{ id: number; name: string }>;
    topDecades?: Array<{ decade: number }>;
    useSignatureScoring?: boolean;
  },
): number[] {
  // If no genre filter, use standard function
  if (!genreIds || genreIds.length === 0) {
    return getWeightedSeedIds(films, limit, true, profile);
  }

  const genreSet = new Set(genreIds);

  // Filter films to only those matching the genre(s)
  const genreFilteredFilms = films.filter((f) => {
    const filmGenres = f.genreIds || [];
    return filmGenres.some((gid) => genreSet.has(gid));
  });

  console.log("[WeightedSeedsByGenre] Filtering for genres:", {
    requestedGenres: genreIds,
    totalFilms: films.length,
    matchingFilms: genreFilteredFilms.length,
  });

  // If we have enough genre-specific films, use them
  if (genreFilteredFilms.length >= minSeeds) {
    const result = getWeightedSeedIds(
      genreFilteredFilms,
      limit,
      false,
      profile,
    ); // No diversity needed within genre
    console.log(
      "[WeightedSeedsByGenre] Using genre-filtered seeds:",
      result.length,
    );
    return result;
  }

  // Fallback: not enough genre-specific films, use global seeds
  console.log(
    "[WeightedSeedsByGenre] Insufficient genre matches, falling back to global seeds",
  );
  return getWeightedSeedIds(films, limit, true, profile);
}

/**
 * Identify "signature films" - absolute favorites that should heavily influence recommendations
 * These are 5-star rated AND liked AND rewatched films
 *
 * NOTE: For more sophisticated signature detection that considers popularity, genre alignment,
 * and decade preferences, use getWeightedSeedIds() with useSignatureScoring enabled.
 */
export function getSignatureFilmIds(films: FilmForSeeding[]): number[] {
  return films
    .filter(
      (f) =>
        f.tmdbId &&
        (f.rating ?? 0) >= 4.5 && // 5 stars (Letterboxd uses 0.5-5 scale, so 4.5+ = 9-10/10)
        f.liked === true &&
        f.rewatch === true,
    )
    .map((f) => f.tmdbId);
}

export async function fetchTrendingIds(
  period: "day" | "week" = "day",
  limit = 100,
): Promise<number[]> {
  const u = new URL("/api/tmdb/trending", getBaseUrl());
  u.searchParams.set("period", period);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("_t", String(Date.now())); // Cache buster
  try {
    console.log("[TMDB] trending start", { period, limit });
    const r = await fetch(u.toString(), { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error("[TMDB] trending error", { status: r.status, body: j });
      return [];
    }
    console.log("[TMDB] trending ok", { count: (j.ids ?? []).length });
    return (j.ids as number[]) || [];
  } catch (e) {
    console.error("[TMDB] trending exception", e);
    return [];
  }
}

/**
 * Fetch related movies from Trakt API for a single seed movie
 * This supplements TMDB's similar/recommendations with community-driven data
 * Uses cache-first strategy to reduce API calls
 */
async function fetchTraktRelatedIds(
  seedId: number,
  limit = 10,
): Promise<number[]> {
  // Check cache first
  const cached = await getCachedTraktRelated(seedId);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - fetch from API
  try {
    const u = new URL("/api/trakt/related", getBaseUrl());
    u.searchParams.set("id", String(seedId));
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("_t", String(Date.now())); // Cache buster

    const r = await fetch(u.toString(), { cache: "no-store" });
    const j = await r.json();

    if (j.ok && j.ids) {
      const ids = j.ids as number[];
      console.log(
        `[Trakt] API fetch: Found ${ids.length} related movies for ${seedId}`,
      );

      // Store in cache for future use
      await setCachedTraktRelated(seedId, ids);

      return ids;
    } else {
      console.warn(
        `[Trakt] No related movies for ${seedId}:`,
        j.error || "Unknown error",
      );
      return [];
    }
  } catch (e) {
    console.error(`[Trakt] Failed to fetch related for ${seedId}`, e);
    return [];
  }
}

/**
 * Fetch similar/recommended movies for a set of seed movie IDs
 * This provides more personalized candidates based on specific films the user liked
 * Now combines TMDB similar/recommendations with Trakt related movies for better diversity
 */
export async function fetchSimilarMovieIds(
  seedIds: number[],
  limitPerSeed = 10,
): Promise<number[]> {
  const allIds = new Set<number>();

  // Limit seeds to avoid too many API calls (increased from 10 to 25 for more diversity)
  const limitedSeeds = seedIds.slice(0, 25);

  for (const seedId of limitedSeeds) {
    try {
      // 1. Fetch TMDB similar/recommendations with caching
      const cachedSimilar = await getCachedTMDBSimilar(seedId);

      if (cachedSimilar !== null) {
        // Cache hit - use cached data
        [...cachedSimilar.similar, ...cachedSimilar.recommendations]
          .slice(0, limitPerSeed)
          .forEach((id) => allIds.add(id));
      } else {
        // Cache miss - fetch from API
        const u = new URL("/api/tmdb/movie", getBaseUrl());
        u.searchParams.set("id", String(seedId));
        u.searchParams.set("_t", String(Date.now())); // Cache buster

        const r = await fetch(u.toString(), { cache: "no-store" });
        const j = await r.json();

        if (j.ok && j.movie) {
          // Get similar movies from the movie's recommendations
          const similar = (j.movie as any).similar?.results || [];
          const recommendations =
            (j.movie as any).recommendations?.results || [];

          const similarIds = similar
            .map((m: any) => m.id)
            .filter((id: number) => id != null);
          const recIds = recommendations
            .map((m: any) => m.id)
            .filter((id: number) => id != null);

          // Store in cache
          await setCachedTMDBSimilar(seedId, similarIds, recIds);

          [...similarIds, ...recIds]
            .slice(0, limitPerSeed)
            .forEach((id) => allIds.add(id));
        }
      }

      // 2. Fetch Trakt related movies (with caching)
      const traktIds = await fetchTraktRelatedIds(seedId, limitPerSeed);
      traktIds.forEach((id) => allIds.add(id));
    } catch (e) {
      console.error(`[TMDB] Failed to fetch similar for ${seedId}`, e);
    }
  }

  console.log(
    `[Discovery] Combined similar movies from TMDB + Trakt: ${allIds.size} unique candidates`,
  );
  return Array.from(allIds);
}

/**
 * Discover movies using TMDB's discover API with specific filters
 * This generates highly personalized candidates based on user's taste profile
 */
export async function discoverMoviesByProfile(options: {
  genres?: number[];
  genreMode?: "AND" | "OR";
  keywords?: number[];
  people?: number[]; // director/actor IDs
  peopleMode?: "AND" | "OR";
  companies?: number[]; // Studio/production company IDs
  yearMin?: number;
  yearMax?: number;
  sortBy?:
    | "vote_average.desc"
    | "popularity.desc"
    | "primary_release_date.desc";
  minVotes?: number;
  limit?: number;
  randomizePage?: boolean; // Add random page offset for variety
}): Promise<number[]> {
  const allIds = new Set<number>();

  // Validate IDs are reasonable
  const validGenres =
    options.genres?.filter((id) => id > 0 && id < 100000) ?? [];
  const validKeywords =
    options.keywords?.filter((id) => id > 0 && id < 1000000) ?? [];
  const validPeople =
    options.people?.filter((id) => id > 0 && id < 10000000) ?? [];
  const validCompanies =
    options.companies?.filter((id) => id > 0 && id < 1000000) ?? [];

  // Log what we're actually sending
  const filterSummary = {
    genres: validGenres,
    genreMode: options.genreMode || "AND",
    keywords: validKeywords.slice(0, 5),
    people: validPeople.slice(0, 3),
    peopleMode: options.peopleMode || "AND",
    yearMin: options.yearMin,
    yearMax: options.yearMax,
    sortBy: options.sortBy,
    minVotes: options.minVotes,
    limit: options.limit ?? 20,
  };

  try {
    const u = new URL("/api/tmdb/discover", getBaseUrl());

    if (validGenres.length) {
      const separator = options.genreMode === "OR" ? "|" : ",";
      u.searchParams.set("with_genres", validGenres.join(separator));
    }
    if (validKeywords.length)
      u.searchParams.set("with_keywords", validKeywords.slice(0, 5).join("|")); // OR logic
    if (validPeople.length) {
      const separator = options.peopleMode === "OR" ? "|" : ",";
      u.searchParams.set(
        "with_people",
        validPeople.slice(0, 3).join(separator),
      );
    }
    if (options.yearMin)
      u.searchParams.set(
        "primary_release_date.gte",
        `${options.yearMin}-01-01`,
      );
    if (options.yearMax)
      u.searchParams.set(
        "primary_release_date.lte",
        `${options.yearMax}-12-31`,
      );
    if (validCompanies.length)
      u.searchParams.set(
        "with_companies",
        validCompanies.slice(0, 3).join("|"),
      );
    if (options.sortBy) u.searchParams.set("sort_by", options.sortBy);
    if (options.minVotes)
      u.searchParams.set("vote_count.gte", String(options.minVotes));

    // Randomize starting page for variety (pages 1-10 for much wider coverage)
    if (options.randomizePage !== false) {
      const randomPage = Math.floor(Math.random() * 10) + 1;
      u.searchParams.set("page", String(randomPage));
    }

    const limit = options.limit ?? 20;
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("_t", String(Date.now())); // Cache buster

    console.log("[TMDB] discover start", filterSummary);
    const r = await fetch(u.toString(), { cache: "no-store" });
    const j = await r.json();

    if (j.ok && j.results) {
      j.results.forEach((m: any) => {
        if (m.id) allIds.add(m.id);
      });
      console.log("[TMDB] discover ok", {
        count: allIds.size,
        filters: filterSummary,
      });
    } else {
      console.warn("[TMDB] discover returned 0 results", {
        filters: filterSummary,
        response: j,
      });
    }
  } catch (e) {
    console.error("[TMDB] discover exception", {
      filters: filterSummary,
      error: e,
    });
  }

  return Array.from(allIds);
}

/**
 * Generate diverse candidates using multiple TMDB discovery strategies
 * This combines trending, similar, and discover APIs for comprehensive coverage
 */
export async function generateSmartCandidates(profile: {
  highlyRatedIds: number[];
  watchlistIds?: number[]; // NEW: User's Letterboxd watchlist for intent-based discovery
  topGenres: Array<{ id: number; weight: number }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
  topActors?: Array<{ id: number; name: string; weight: number }>;
  topStudios?: Array<{ id: number; name: string; weight: number }>;
  topDecades?: Array<{ decade: number; weight: number }>;
  excludeYearRange?: { min?: number; max?: number };
  tmdbDetailsMap?: Map<number, { title?: string; imdb_id?: string }>;
  // Issue #7: TuiMDB niche genre preferences
  nichePreferences?: {
    likesAnime: boolean;
    likesStandUp: boolean;
    likesFoodDocs: boolean;
    likesTravelDocs: boolean;
  };
  // NEW: Preferred subgenre keyword IDs from learned patterns
  // These are TMDB keyword IDs corresponding to subgenres the user loves
  preferredSubgenreKeywordIds?: number[];
}): Promise<{
  trending: number[];
  similar: number[];
  discovered: number[];
  sourceMetadata: Map<
    number,
    { sources: string[]; consensusLevel: "high" | "medium" | "low" }
  >;
}> {
  console.log("[SmartCandidates] Generating with enhanced profile", {
    highlyRatedCount: profile.highlyRatedIds.length,
    watchlistCount: profile.watchlistIds?.length ?? 0,
    topGenresCount: profile.topGenres.length,
    topKeywordsCount: profile.topKeywords.length,
    topDirectorsCount: profile.topDirectors.length,
    topActorsCount: profile.topActors?.length ?? 0,
    topStudiosCount: profile.topStudios?.length ?? 0,
    hasTmdbDetails: !!profile.tmdbDetailsMap,
  });

  const results = {
    trending: [] as number[],
    similar: [] as number[],
    discovered: [] as number[],
    sourceMetadata: new Map<
      number,
      { sources: string[]; consensusLevel: "high" | "medium" | "low" }
    >(),
  };

  // 1. Trending movies (randomize between day/week for variety)
  try {
    const period = Math.random() > 0.5 ? "day" : "week";
    results.trending = await fetchTrendingIds(period, 100);
  } catch (e) {
    console.error("[SmartCandidates] Trending failed", e);
  }

  // 2. Multi-Source Aggregation (REPLACES old TMDB+Trakt similar fetching)
  // This is now the PRIMARY source for similar movie recommendations
  try {
    if (profile.highlyRatedIds.length > 0) {
      console.log(
        "[SmartCandidates] Running multi-source aggregation (primary similar source)",
      );

      // Import Server Action (safe for client use)
      const { getAggregatedRecommendations } = await import(
        "@/app/actions/recommendations"
      );

      // Combine highly-rated films with watchlist for richer seed pool
      // highlyRatedIds = what user loved (past preferences)
      // watchlistIds = what user wants to watch (future intent/discovery signals)
      const combinedSeedIds = [
        ...profile.highlyRatedIds.slice(0, 20), // Top 20 from watch history
        ...(profile.watchlistIds?.slice(0, 10) ?? []), // Top 10 from watchlist (intent signals)
      ];

      // Deduplicate while preserving order
      const uniqueSeedIds = [...new Set(combinedSeedIds)].slice(0, 25);

      const seedMovies = uniqueSeedIds.map((tmdbId) => {
        const details = profile.tmdbDetailsMap?.get(tmdbId);
        return {
          tmdbId,
          title: details?.title ?? "",
          imdbId: details?.imdb_id,
        };
      });

      const seedMoviesWithTitles = seedMovies.filter((s) => s.title); // TasteDive needs title

      console.log("[SmartCandidates] Seed movies:", {
        fromHighlyRated: Math.min(20, profile.highlyRatedIds.length),
        fromWatchlist: Math.min(10, profile.watchlistIds?.length ?? 0),
        combined: uniqueSeedIds.length,
        total: seedMovies.length,
        withTitles: seedMoviesWithTitles.length,
        withoutTitles: seedMovies.length - seedMoviesWithTitles.length,
        sampleTitles: seedMoviesWithTitles.slice(0, 5).map((s) => s.title),
      });

      const aggregated = await getAggregatedRecommendations({
        seedMovies,
        limit: 75, // Increased from 50 to surface more Trakt/TasteDive results
      });

      // Add high-scoring recommendations and track source metadata
      for (const rec of aggregated) {
        // Only add if score is decent
        if (rec.score > 0.5) {
          results.similar.push(rec.tmdbId);

          // Store source metadata for multi-source badge display
          results.sourceMetadata.set(rec.tmdbId, {
            sources: rec.sources.map((s) => s.source),
            consensusLevel: rec.consensusLevel,
          });
        }
      }

      console.log(
        "[SmartCandidates] Aggregated recommendations added:",
        results.similar.length,
        "with source tracking:",
        results.sourceMetadata.size,
      );
    }
  } catch (e) {
    console.error("[SmartCandidates] Multi-source aggregation failed", e);

    // Fallback to old method if aggregator fails
    console.log("[SmartCandidates] Falling back to legacy similar fetching");
    try {
      if (profile.highlyRatedIds.length > 0) {
        const shuffled = [...profile.highlyRatedIds].sort(
          () => Math.random() - 0.5,
        );
        results.similar = await fetchSimilarMovieIds(shuffled.slice(0, 20), 30);
      }
    } catch (fallbackError) {
      console.error("[SmartCandidates] Fallback similar failed", fallbackError);
    }
  }

  // 3. Discover by top genres + keywords (with progressive fallbacks and temporal diversity)
  try {
    if (profile.topGenres.length > 0) {
      // Shuffle genre/keyword selection more aggressively
      const shuffledGenres = [...profile.topGenres].sort(
        () => Math.random() - 0.5,
      );
      const shuffledKeywords = [...profile.topKeywords].sort(
        () => Math.random() - 0.5,
      );

      // Use minimum 2 genres/keywords for better specificity (never just 1)
      const genreCount = Math.floor(Math.random() * 2) + 2; // 2-3 genres
      const keywordCount = Math.floor(Math.random() * 3) + 2; // 2-4 keywords

      // Weighted sort selection: 60% quality, 25% popularity, 15% recency
      const sortRand = Math.random();
      const randomSort =
        sortRand < 0.6
          ? "vote_average.desc"
          : sortRand < 0.85
            ? "popularity.desc"
            : "primary_release_date.desc";

      // Add temporal diversity - randomly pick a year range or none
      const currentYear = new Date().getFullYear();
      const temporalStrategies = [
        {}, // No year filter
        { yearMin: 2020, yearMax: currentYear }, // Recent
        { yearMin: 2010, yearMax: 2019 }, // Modern classics
        { yearMin: 2000, yearMax: 2009 }, // 2000s
        { yearMin: 1990, yearMax: 1999 }, // 90s
      ];
      const temporalFilter =
        temporalStrategies[
          Math.floor(Math.random() * temporalStrategies.length)
        ];

      // Try 1: Genres + keywords with random temporal filter
      let genreDiscovered = await discoverMoviesByProfile({
        genres: shuffledGenres.slice(0, genreCount).map((g) => g.id),
        genreMode: "OR", // Match ANY of the top genres
        keywords: shuffledKeywords.slice(0, keywordCount).map((k) => k.id),
        sortBy: randomSort,
        minVotes: 100,
        limit: 150,
        ...temporalFilter,
      });
      results.discovered.push(...genreDiscovered);
      console.log("[SmartCandidates] Genre+keyword discovery", {
        count: genreDiscovered.length,
        genreCount,
        keywordCount,
        sortBy: randomSort,
        sortWeight:
          sortRand < 0.6
            ? "quality-first (60%)"
            : sortRand < 0.85
              ? "popularity (25%)"
              : "recency (15%)",
        temporal: temporalFilter,
      });

      // Fallback 1: Just genres with different temporal filter
      if (genreDiscovered.length < 30) {
        const altTemporalFilter =
          temporalStrategies[
            Math.floor(Math.random() * temporalStrategies.length)
          ];

        // Weighted sort selection: 60% quality, 25% popularity, 15% recency
        const fallbackSortRand = Math.random();
        const fallbackSort =
          fallbackSortRand < 0.6
            ? "vote_average.desc"
            : fallbackSortRand < 0.85
              ? "popularity.desc"
              : "primary_release_date.desc";

        const genreOnlyDiscovered = await discoverMoviesByProfile({
          genres: shuffledGenres
            .slice(0, Math.floor(Math.random() * 2) + 2) // 2-3 genres (minimum 2)
            .map((g) => g.id),
          genreMode: "OR",
          sortBy: fallbackSort,
          minVotes: 50,
          limit: 150,
          ...altTemporalFilter,
        });
        results.discovered.push(...genreOnlyDiscovered);
        console.log("[SmartCandidates] Genre-only fallback", {
          count: genreOnlyDiscovered.length,
        });
      }

      // Fallback 2: Popular in genres (lower vote threshold, different temporal)
      if (results.discovered.length < 100) {
        const altTemporalFilter =
          temporalStrategies[
            Math.floor(Math.random() * temporalStrategies.length)
          ];
        const popularDiscovered = await discoverMoviesByProfile({
          genres: shuffledGenres
            .slice(0, Math.floor(Math.random() * 3) + 1)
            .map((g) => g.id),
          genreMode: "OR",
          sortBy: "popularity.desc",
          minVotes: 20,
          limit: 150,
          ...altTemporalFilter,
        });
        results.discovered.push(...popularDiscovered);
        console.log("[SmartCandidates] Popular fallback", {
          count: popularDiscovered.length,
        });
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Genre+keyword discovery failed", e);
  }

  // 4. Discover by favorite directors (no year restrictions)
  // Issue #11: Expanded from 3 to 8 directors for users with diverse tastes
  try {
    if (profile.topDirectors.length > 0) {
      // Shuffle director selection for variety
      const shuffledDirectors = [...profile.topDirectors].sort(
        () => Math.random() - 0.5,
      );

      // Try with top directors (expanded from 3 to 8), no year filter
      const directorDiscovered = await discoverMoviesByProfile({
        people: shuffledDirectors.slice(0, 8).map((d) => d.id),
        peopleMode: "OR", // Match ANY of the top directors
        sortBy: "vote_average.desc",
        limit: 100,
      });
      results.discovered.push(...directorDiscovered);
      console.log("[SmartCandidates] Director discovery", {
        count: directorDiscovered.length,
        directors: shuffledDirectors
          .slice(0, 8)
          .map((d) => ({ id: d.id, name: d.name })),
      });

      // Fallback: Try with single director if multiple directors returned nothing
      if (directorDiscovered.length === 0 && shuffledDirectors.length > 0) {
        const singleDirector = await discoverMoviesByProfile({
          people: [shuffledDirectors[0].id],
          sortBy: "vote_average.desc", // Quality-first for director discovery
          limit: 50,
        });
        results.discovered.push(...singleDirector);
        console.log("[SmartCandidates] Single director fallback", {
          count: singleDirector.length,
        });
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Director discovery failed", e);
  }

  // 5. Discover niche subgenre picks by keywords (no year restrictions)
  try {
    if (profile.topKeywords.length > 2 && results.discovered.length < 200) {
      // Take random keywords for variety
      const shuffledKeywords = [...profile.topKeywords].sort(
        () => Math.random() - 0.5,
      );
      const nicheDiscovered = await discoverMoviesByProfile({
        keywords: shuffledKeywords.slice(0, 2).map((k) => k.id),
        sortBy: "vote_average.desc", // Quality-first for niche discovery
        minVotes: 30,
        limit: 100,
      });
      results.discovered.push(...nicheDiscovered);
      console.log("[SmartCandidates] Niche keyword discovery", {
        count: nicheDiscovered.length,
        keywords: shuffledKeywords
          .slice(0, 2)
          .map((k) => ({ id: k.id, name: k.name })),
      });
    }
  } catch (e) {
    console.error("[SmartCandidates] Niche discovery failed", e);
  }

  // 5c. NEW: Preferred subgenre keyword discovery
  // Uses learned subgenre patterns (e.g., "folk horror", "psychological thriller")
  try {
    if (
      profile.preferredSubgenreKeywordIds?.length &&
      results.discovered.length < 400
    ) {
      console.log(
        "[SmartCandidates] Running preferred subgenre keyword discovery",
        {
          keywordIds: profile.preferredSubgenreKeywordIds.slice(0, 5),
        },
      );

      const subgenreDiscovered = await discoverMoviesByProfile({
        keywords: profile.preferredSubgenreKeywordIds.slice(0, 5),
        sortBy: "vote_average.desc",
        minVotes: 50,
        limit: 75,
      });
      results.discovered.push(...subgenreDiscovered);

      console.log("[SmartCandidates] Subgenre keyword discovery", {
        count: subgenreDiscovered.length,
        keywordIds: profile.preferredSubgenreKeywordIds.slice(0, 5),
      });

      // Also try with popularity sort for variety
      if (
        subgenreDiscovered.length < 30 &&
        profile.preferredSubgenreKeywordIds.length >= 3
      ) {
        const subgenrePopular = await discoverMoviesByProfile({
          keywords: profile.preferredSubgenreKeywordIds.slice(0, 3),
          sortBy: "popularity.desc",
          minVotes: 30,
          limit: 50,
        });
        results.discovered.push(...subgenrePopular);
        console.log(
          "[SmartCandidates] Subgenre keyword discovery (popular fallback)",
          {
            count: subgenrePopular.length,
          },
        );
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Subgenre keyword discovery failed", e);
  }

  // 5b. CROSS-API COMPATIBLE: Enhanced preferred genre discovery
  // Instead of relying on sparse TMDB keyword IDs, we fetch more genre candidates
  // Text-based detectSubgenres() will filter these to matching subgenres later
  // This approach works with Trakt, TasteDive, and any other recommendation source
  try {
    if (profile.topGenres.length > 0 && results.discovered.length < 300) {
      console.log(
        "[SmartCandidates] Running enhanced genre discovery (cross-API compatible)",
        {
          topGenres: profile.topGenres,
          approach: "genre-based discovery + text filtering",
        },
      );

      // Fetch more candidates from top genres for subgenre text filtering
      for (const sortBy of ["vote_average.desc", "popularity.desc"] as const) {
        const enhancedDiscovered = await discoverMoviesByProfile({
          genres: profile.topGenres.slice(0, 3).map((g) => g.id),
          genreMode: "OR",
          sortBy,
          minVotes: 50,
          limit: 150, // Increased to get more candidates for text-based subgenre detection
        });
        results.discovered.push(...enhancedDiscovered);
        console.log(
          `[SmartCandidates] Enhanced genre discovery (${sortBy}):`,
          enhancedDiscovered.length,
        );
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Enhanced genre discovery failed", e);
  }

  // 6. Add pure genre-based discovery with varied temporal ranges
  try {
    if (profile.topGenres.length > 0 && results.discovered.length < 200) {
      const shuffledGenres = [...profile.topGenres].sort(
        () => Math.random() - 0.5,
      );
      const sortMethods = [
        "vote_average.desc",
        "popularity.desc",
        "primary_release_date.desc",
      ] as const;
      const currentYear = new Date().getFullYear();

      // Randomly select temporal range
      const temporalOptions = [
        {},
        { yearMin: 2015, yearMax: currentYear },
        { yearMin: 2000, yearMax: 2014 },
        { yearMin: 1980, yearMax: 1999 },
      ];
      const temporal =
        temporalOptions[Math.floor(Math.random() * temporalOptions.length)];

      const pureGenreDiscovered = await discoverMoviesByProfile({
        genres: shuffledGenres
          .slice(0, Math.floor(Math.random() * 3) + 1)
          .map((g) => g.id),
        genreMode: "OR",
        sortBy: sortMethods[Math.floor(Math.random() * sortMethods.length)],
        minVotes: 100,
        limit: 100,
        ...temporal,
      });
      results.discovered.push(...pureGenreDiscovered);
    }
  } catch (e) {
    console.error("[SmartCandidates] Pure genre discovery failed", e);
  }

  // 7. Add diverse picks with single genre (no year restriction)
  try {
    if (profile.topGenres.length > 0 && results.discovered.length < 300) {
      // Try with just the top genre to cast wider net
      const topGenre = profile.topGenres[0];
      const singleGenreDiscovered = await discoverMoviesByProfile({
        genres: [topGenre.id],
        sortBy: "vote_average.desc", // Quality-first for genre discovery
        minVotes: 100,
        limit: 100,
      });
      results.discovered.push(...singleGenreDiscovered);
      console.log("[SmartCandidates] Single genre discovery", {
        count: singleGenreDiscovered.length,
        genreId: topGenre.id,
      });
    }
  } catch (e) {
    console.error("[SmartCandidates] Single genre discovery failed", e);
  }

  // 8. Issue #7: TuiMDB niche genre discovery (Anime, Food docs, Travel docs)
  // These are unique to TuiMDB and not covered by standard TMDB genres
  if (profile.nichePreferences) {
    try {
      const niche = profile.nichePreferences;

      // Anime discovery (Animation genre + anime-related keywords)
      if (niche.likesAnime && results.discovered.length < 350) {
        const animationGenreId = 16; // TMDB Animation genre
        const animeKeywords = [210024, 6534, 9715, 1663]; // anime, japanese animation, manga, studio ghibli
        const animeDiscovered = await discoverMoviesByProfile({
          genres: [animationGenreId],
          keywords: animeKeywords.slice(0, 2),
          sortBy: "vote_average.desc",
          minVotes: 50,
          limit: 50,
        });
        results.discovered.push(...animeDiscovered);
        console.log("[SmartCandidates] Anime discovery (TuiMDB #7)", {
          count: animeDiscovered.length,
        });
      }

      // Food documentary discovery
      if (niche.likesFoodDocs && results.discovered.length < 350) {
        const docGenreId = 99; // TMDB Documentary genre
        const foodKeywords = [1726, 5565, 1424, 803]; // cooking, food, chef, restaurant
        const foodDocDiscovered = await discoverMoviesByProfile({
          genres: [docGenreId],
          keywords: foodKeywords.slice(0, 2),
          sortBy: "popularity.desc",
          minVotes: 20,
          limit: 30,
        });
        results.discovered.push(...foodDocDiscovered);
        console.log("[SmartCandidates] Food doc discovery (TuiMDB #7)", {
          count: foodDocDiscovered.length,
        });
      }

      // Travel documentary discovery
      if (niche.likesTravelDocs && results.discovered.length < 350) {
        const docGenreId = 99; // TMDB Documentary genre
        const travelKeywords = [699, 3616, 252, 10842]; // travel, journey, adventure, expedition
        const travelDocDiscovered = await discoverMoviesByProfile({
          genres: [docGenreId],
          keywords: travelKeywords.slice(0, 2),
          sortBy: "popularity.desc",
          minVotes: 20,
          limit: 30,
        });
        results.discovered.push(...travelDocDiscovered);
        console.log("[SmartCandidates] Travel doc discovery (TuiMDB #7)", {
          count: travelDocDiscovered.length,
        });
      }
    } catch (e) {
      console.error("[SmartCandidates] Niche genre discovery failed", e);
    }
  }

  // 9. NEW: Actor-based discovery (like directors, but for top actors)
  try {
    if (
      profile.topActors &&
      profile.topActors.length > 0 &&
      results.discovered.length < 400
    ) {
      const shuffledActors = [...profile.topActors].sort(
        () => Math.random() - 0.5,
      );

      // Discover movies featuring user's favorite actors
      const actorDiscovered = await discoverMoviesByProfile({
        people: shuffledActors.slice(0, 5).map((a) => a.id),
        peopleMode: "OR", // Match ANY of the top actors
        sortBy: "vote_average.desc",
        minVotes: 50,
        limit: 75,
      });
      results.discovered.push(...actorDiscovered);
      console.log("[SmartCandidates] Actor discovery", {
        count: actorDiscovered.length,
        actors: shuffledActors.slice(0, 5).map((a) => a.name),
      });

      // Also try popularity-sorted for variety
      if (actorDiscovered.length < 30) {
        const actorPopular = await discoverMoviesByProfile({
          people: shuffledActors.slice(0, 3).map((a) => a.id),
          peopleMode: "OR",
          sortBy: "popularity.desc",
          limit: 50,
        });
        results.discovered.push(...actorPopular);
        console.log("[SmartCandidates] Actor discovery (popular)", {
          count: actorPopular.length,
        });
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Actor discovery failed", e);
  }

  // 10. NEW: Genre combination discovery (multi-genre patterns)
  // Detect and discover by genre pairs that the user frequently enjoys together
  try {
    if (profile.topGenres.length >= 2 && results.discovered.length < 450) {
      const topGenreIds = profile.topGenres.slice(0, 4).map((g) => g.id);

      // Generate genre pairs from top genres
      const genrePairs: [number, number][] = [];
      for (let i = 0; i < topGenreIds.length; i++) {
        for (let j = i + 1; j < topGenreIds.length; j++) {
          genrePairs.push([topGenreIds[i], topGenreIds[j]]);
        }
      }

      // Shuffle and pick 2-3 pairs to discover
      const shuffledPairs = genrePairs
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);

      for (const [genre1, genre2] of shuffledPairs) {
        const comboDiscovered = await discoverMoviesByProfile({
          genres: [genre1, genre2],
          genreMode: "AND", // Must have BOTH genres
          sortBy: "vote_average.desc",
          minVotes: 50,
          limit: 40,
        });
        results.discovered.push(...comboDiscovered);
        console.log("[SmartCandidates] Genre combo discovery", {
          genres: [genre1, genre2],
          count: comboDiscovered.length,
        });
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Genre combo discovery failed", e);
  }

  // 11. NEW: Studio-based discovery (for A24, Ghibli, Blumhouse fans)
  try {
    if (
      profile.topStudios &&
      profile.topStudios.length > 0 &&
      results.discovered.length < 480
    ) {
      // Only use studios with meaningful weight (user has watched multiple films from them)
      const significantStudios = profile.topStudios.filter(
        (s) => s.weight >= 2,
      );

      if (significantStudios.length > 0) {
        const shuffledStudios = [...significantStudios].sort(
          () => Math.random() - 0.5,
        );

        // TMDB company-based discovery (use top 2 studios)
        for (const studio of shuffledStudios.slice(0, 2)) {
          const studioDiscovered = await discoverMoviesByProfile({
            companies: [studio.id],
            sortBy: "vote_average.desc",
            minVotes: 30,
            limit: 40,
          });
          results.discovered.push(...studioDiscovered);
          console.log("[SmartCandidates] Studio discovery", {
            studio: studio.name,
            studioId: studio.id,
            count: studioDiscovered.length,
          });
        }
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Studio discovery failed", e);
  }

  // 12. Decade-weighted discovery using user's preferred eras
  try {
    // Use user's actual preferred decades from taste profile, with sensible defaults
    const userDecades =
      profile.topDecades?.slice(0, 3).map((d) => d.decade) || [];
    const preferredDecades =
      userDecades.length > 0 ? userDecades : [2010, 2000, 1990]; // Default fallback if no decade preference

    if (profile.topGenres.length >= 2 && results.discovered.length < 500) {
      const currentYear = new Date().getFullYear();

      // Build decade strategies from user's preferred decades
      const decadeStrategies = preferredDecades.map((decade) => ({
        yearMin: decade,
        yearMax: Math.min(decade + 9, currentYear),
        label: `${decade}s`,
      }));

      // Pick 1-2 strategies randomly for variety
      const pickedStrategies = decadeStrategies
        .sort(() => Math.random() - 0.5)
        .slice(0, 2);

      for (const strategy of pickedStrategies) {
        const shuffledGenres = [...profile.topGenres].sort(
          () => Math.random() - 0.5,
        );

        const decadeDiscovered = await discoverMoviesByProfile({
          genres: shuffledGenres.slice(0, 2).map((g) => g.id),
          genreMode: "OR",
          yearMin: strategy.yearMin,
          yearMax: strategy.yearMax,
          sortBy: "vote_average.desc",
          minVotes: 100,
          limit: 50,
        });
        results.discovered.push(...decadeDiscovered);
        console.log(`[SmartCandidates] Decade discovery (${strategy.label})`, {
          years: `${strategy.yearMin}-${strategy.yearMax}`,
          count: decadeDiscovered.length,
          source: userDecades.length > 0 ? "user-preference" : "default",
        });
      }
    }
  } catch (e) {
    console.error("[SmartCandidates] Decade discovery failed", e);
  }

  console.log("[SmartCandidates] Generated", {
    trending: results.trending.length,
    similar: results.similar.length,
    discovered: results.discovered.length,
    total:
      results.trending.length +
      results.similar.length +
      results.discovered.length,
  });

  // Ensure all candidates have source metadata (default to TMDB/low if not set by aggregator)
  // This is critical for pairwise comparisons to have valid consensus data
  const ensureMetadata = (id: number) => {
    if (!results.sourceMetadata.has(id)) {
      results.sourceMetadata.set(id, {
        sources: ["tmdb"],
        consensusLevel: "low",
      });
    }
  };
  results.trending.forEach(ensureMetadata);
  results.discovered.forEach(ensureMetadata);

  return results;
}

/**
 * Fetch popular movies from a specific decade
 */
export async function getDecadeCandidates(
  decade: number,
  limit = 20,
): Promise<number[]> {
  const yearMin = decade;
  const yearMax = decade + 9;

  console.log(
    `[DecadeCandidates] Fetching for ${decade}s (${yearMin}-${yearMax})`,
  );

  return discoverMoviesByProfile({
    yearMin,
    yearMax,
    sortBy: "popularity.desc",
    minVotes: 50,
    limit,
  });
}

/**
 * Fetch "Hidden Gems" - highly rated but less mainstream movies
 * Matches user's top genres/decades but filters for specific vote counts
 */
export async function getSmartDiscoveryCandidates(
  profile: {
    topGenres: Array<{ id: number; weight: number }>;
    topDecades: Array<{ decade: number; weight: number }>;
  },
  limit = 20,
): Promise<number[]> {
  console.log("[SmartDiscovery] Fetching hidden gems");

  const allIds = new Set<number>();

  // Strategy 1: Top genres, high rating, moderate popularity (hidden gems)
  if (profile.topGenres.length > 0) {
    const genreIds = profile.topGenres.slice(0, 3).map((g) => g.id);
    const gems = await discoverMoviesByProfile({
      genres: genreIds,
      genreMode: "OR",
      sortBy: "vote_average.desc",
      minVotes: 50, // Enough to be valid
      // We can't easily max votes in discover API directly without complex logic,
      // but we can sort by vote_average which tends to surface smaller films if minVotes is low.
      // Alternatively, we rely on the fact that we're asking for high rated stuff.
      limit: limit * 2,
    });

    // Client-side filter if needed, but for now just take them
    gems.forEach((id) => allIds.add(id));
  }

  // Strategy 2: Top decades, high rating
  if (profile.topDecades.length > 0) {
    const decade = profile.topDecades[0].decade;
    const decadeGems = await discoverMoviesByProfile({
      yearMin: decade,
      yearMax: decade + 9,
      sortBy: "vote_average.desc",
      minVotes: 50,
      limit: limit,
    });
    decadeGems.forEach((id) => allIds.add(id));
  }

  return Array.from(allIds).slice(0, limit);
}

/**
 * Generate exploratory movie picks for discovery
 * Balances safe bets with adjacent genre exploration and acclaimed films
 *
 * @param profile - User's taste profile with top genres and avoided genres
 * @param options - Configuration for exploratory picks
 * @returns Array of TMDB movie IDs for exploratory suggestions
 */
export async function generateExploratoryPicks(
  profile: {
    topGenres: Array<{ id: number; name: string; weight: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number }>;
  },
  options: {
    count: number; // How many exploratory picks to generate
    minVoteAverage?: number; // Minimum quality threshold
    minVoteCount?: number; // Minimum vote count for reliability
  },
): Promise<number[]> {
  const exploratoryIds: number[] = [];

  // Strategy 1: Adjacent genres (70% of exploratory picks)
  const adjacentCount = Math.floor(options.count * 0.7);
  const adjacentIds = await getAdjacentGenrePicks(
    profile,
    adjacentCount,
    options,
  );
  exploratoryIds.push(...adjacentIds);

  // Strategy 2: Critically acclaimed outside comfort zone (30% of exploratory picks)
  const acclaimedCount = options.count - adjacentCount;
  const acclaimedIds = await getCriticallyAcclaimedPicks(
    profile,
    acclaimedCount,
    options,
  );
  exploratoryIds.push(...acclaimedIds);

  console.log("[Exploration] Generated exploratory picks", {
    total: exploratoryIds.length,
    adjacent: adjacentIds.length,
    acclaimed: acclaimedIds.length,
    targetCount: options.count,
  });

  return exploratoryIds;
}

/**
 * Get films from adjacent genres for gentle discovery expansion
 */
async function getAdjacentGenrePicks(
  profile: {
    topGenres: Array<{ id: number; name: string; weight: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number }>;
  },
  count: number,
  options: { minVoteAverage?: number; minVoteCount?: number },
): Promise<number[]> {
  if (count === 0) return [];

  const adjacentGenres = new Set<number>();
  const avoidedGenreIds = new Set(profile.avoidGenres.map((g) => g.id));
  const topGenreIds = new Set(profile.topGenres.map((g) => g.id));

  // Find adjacent genres to user's top 3 genres
  for (const genre of profile.topGenres.slice(0, 3)) {
    const adjacent = ADJACENT_GENRES[genre.id] || [];
    adjacent.forEach((adjId) => {
      // Don't add if it's already a top genre or an avoided genre
      const isTopGenre = topGenreIds.has(adjId);
      const isAvoided = avoidedGenreIds.has(adjId);
      if (!isTopGenre && !isAvoided) {
        adjacentGenres.add(adjId);
      }
    });
  }

  if (adjacentGenres.size === 0) {
    console.log("[Exploration] No adjacent genres found for exploration");
    return [];
  }

  // Query TMDB discover API for adjacent genre films
  const adjacentGenreArray = Array.from(adjacentGenres);
  const randomGenre =
    adjacentGenreArray[Math.floor(Math.random() * adjacentGenreArray.length)];

  console.log("[Exploration] Exploring adjacent genre", {
    genreId: randomGenre,
    fromTopGenres: profile.topGenres.slice(0, 3).map((g) => g.name),
    availableAdjacent: adjacentGenreArray.length,
  });

  const ids = await discoverMoviesByProfile({
    genres: [randomGenre],
    genreMode: "AND",
    sortBy: "vote_average.desc",
    minVotes: options.minVoteCount || 500,
    limit: count * 2, // Request more than needed for variety
  });

  // Shuffle and return requested count
  return ids.sort(() => Math.random() - 0.5).slice(0, count);
}

/**
 * Get critically acclaimed films outside user's top genres
 */
async function getCriticallyAcclaimedPicks(
  profile: {
    topGenres: Array<{ id: number; name: string; weight: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number }>;
  },
  count: number,
  options: { minVoteAverage?: number; minVoteCount?: number },
): Promise<number[]> {
  if (count === 0) return [];

  const topGenreIds = new Set(profile.topGenres.map((g) => g.id));
  const avoidedGenreIds = new Set(profile.avoidGenres.map((g) => g.id));

  // All major genres
  const allGenres = [
    28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878,
    10770, 53, 10752, 37,
  ];
  const explorationGenres = allGenres.filter(
    (id) => !topGenreIds.has(id) && !avoidedGenreIds.has(id),
  );

  if (explorationGenres.length === 0) {
    console.log(
      "[Exploration] No exploration genres available (all are top or avoided)",
    );
    return [];
  }

  // Pick a random exploration genre
  const randomGenre =
    explorationGenres[Math.floor(Math.random() * explorationGenres.length)];

  console.log("[Exploration] Exploring acclaimed films in new genre", {
    genreId: randomGenre,
    availableGenres: explorationGenres.length,
  });

  // Query for highly-rated films in this genre
  const ids = await discoverMoviesByProfile({
    genres: [randomGenre],
    genreMode: "AND",
    sortBy: "vote_average.desc",
    minVotes: options.minVoteCount || 1000, // Higher threshold for acclaimed films
    limit: count * 2,
  });

  return ids.sort(() => Math.random() - 0.5).slice(0, count);
}
