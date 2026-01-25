import { supabase } from "@/lib/supabaseClient";

export type FatigueType = "mono-genre" | "intensity" | "heavy-drama";

export interface FatigueDetection {
  type: FatigueType;
  genre?: string;
  count: number;
  message: string;
}

type RecentDiaryMovie = {
  tmdbId: number;
  watchedAt?: string | null;
  genres: string[];
  voteAverage?: number;
  runtime?: number;
};

const HIGH_INTENSITY_GENRES = ["Horror", "Thriller", "Action", "War"] as const;
const LIGHT_GENRES = [
  "Comedy",
  "Animation",
  "Romance",
  "Musical",
  "Family",
  "Fantasy",
] as const;
const HEAVY_GENRES = ["War", "Documentary", "Biography", "History"] as const;

const isDev = process.env.NODE_ENV === "development";

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function getGenresFromMovieData(
  data: Record<string, unknown> | null,
): string[] {
  if (!data) return [];
  const genres = (data as { genres?: Array<{ name?: string }> }).genres || [];
  return genres.map((g) => g.name).filter(Boolean) as string[];
}

function getVoteAverageFromMovieData(
  data: Record<string, unknown> | null,
): number | undefined {
  if (!data) return undefined;
  const value = (data as { vote_average?: number }).vote_average;
  return typeof value === "number" ? value : undefined;
}

function getRuntimeFromMovieData(
  data: Record<string, unknown> | null,
): number | undefined {
  if (!data) return undefined;
  const value = (data as { runtime?: number }).runtime;
  return typeof value === "number" ? value : undefined;
}

async function getRecentDiaryMovies(
  userId: string,
  limit: number,
): Promise<RecentDiaryMovie[]> {
  const client = supabase;
  if (!client) return [];

  const { data: diaryEvents, error } = await client
    .from("film_diary_events_enriched")
    .select("tmdb_id, watched_at")
    .eq("user_id", userId)
    .order("watched_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isDev) {
      console.error("[CounterProgramming] Failed to fetch diary events", error);
    }
    return [];
  }

  const orderedEvents = (diaryEvents || []).filter(
    (event) => typeof event.tmdb_id === "number",
  ) as Array<{ tmdb_id: number; watched_at: string | null }>;
  const orderedIds = orderedEvents.map((event) => event.tmdb_id);

  if (orderedIds.length === 0) return [];

  const { data: movieRows, error: movieError } = await client
    .from("tmdb_movies")
    .select("tmdb_id, data")
    .in("tmdb_id", orderedIds);

  if (movieError) {
    if (isDev) {
      console.error(
        "[CounterProgramming] Failed to fetch TMDB cache",
        movieError,
      );
    }
    return [];
  }

  const movieMap = new Map<number, Record<string, unknown>>();
  for (const row of movieRows || []) {
    if (row.tmdb_id && row.data) {
      movieMap.set(row.tmdb_id, row.data as Record<string, unknown>);
    }
  }

  return orderedIds.map((tmdbId, index) => {
    const event = orderedEvents[index];
    const data = movieMap.get(tmdbId) ?? null;
    return {
      tmdbId,
      watchedAt: event?.watched_at ?? null,
      genres: getGenresFromMovieData(data),
      voteAverage: getVoteAverageFromMovieData(data),
      runtime: getRuntimeFromMovieData(data),
    };
  });
}

function detectMonoGenreFatigue(
  recentMovies: RecentDiaryMovie[],
): { genre: string; count: number } | null {
  const streaks = new Map<string, number>();
  let best: { genre: string; count: number } | null = null;

  for (const movie of recentMovies) {
    const genreSet = new Set(movie.genres);

    for (const key of Array.from(streaks.keys())) {
      if (!genreSet.has(key)) {
        streaks.set(key, 0);
      }
    }

    for (const genre of genreSet) {
      const next = (streaks.get(genre) ?? 0) + 1;
      streaks.set(genre, next);
      if (next >= 5 && (!best || next > best.count)) {
        best = { genre, count: next };
      }
    }
  }

  return best;
}

function countIntensityFilms(recentMovies: RecentDiaryMovie[]): number {
  const intensitySet = toLowerSet([...HIGH_INTENSITY_GENRES]);
  return recentMovies.filter((movie) =>
    movie.genres.some((genre) => intensitySet.has(genre.toLowerCase())),
  ).length;
}

function countHeavyDramaFilms(recentMovies: RecentDiaryMovie[]): number {
  const heavySet = toLowerSet([...HEAVY_GENRES]);
  return recentMovies.filter((movie) => {
    const genreSet = toLowerSet(movie.genres);
    if ([...heavySet].some((genre) => genreSet.has(genre))) return true;
    if (genreSet.has("drama") && (movie.voteAverage ?? 10) < 6.5) return true;
    return false;
  }).length;
}

async function getUserTopGenres(
  userId: string,
  limit: number = 200,
): Promise<Array<{ name: string; count: number }>> {
  const recentMovies = await getRecentDiaryMovies(userId, limit);
  const genreCounts = new Map<string, number>();

  for (const movie of recentMovies) {
    for (const genre of movie.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  return Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export async function detectGenreFatigue(
  userId: string,
): Promise<FatigueDetection | null> {
  try {
    const recentMovies = await getRecentDiaryMovies(userId, 10);
    if (recentMovies.length === 0) return null;

    const mono = detectMonoGenreFatigue(recentMovies);
    if (mono) {
      const message = `You've watched ${mono.count} ${mono.genre} films recently. Here are some lighter picks to refresh your palate.`;
      if (isDev) {
        console.log(
          `[CounterProgramming] Detected mono-genre fatigue: ${mono.genre} (${mono.count} films)`,
        );
      }
      return {
        type: "mono-genre",
        genre: mono.genre,
        count: mono.count,
        message,
      };
    }

    const intensityCount = countIntensityFilms(recentMovies);
    if (intensityCount >= 7) {
      if (isDev) {
        console.log(
          `[CounterProgramming] Detected intensity fatigue (${intensityCount} films)`,
        );
      }
      return {
        type: "intensity",
        count: intensityCount,
        message:
          "After all that intensity, here are some feel-good films to balance things out.",
      };
    }

    const heavyDramaCount = countHeavyDramaFilms(recentMovies);
    if (heavyDramaCount >= 5) {
      if (isDev) {
        console.log(
          `[CounterProgramming] Detected heavy-drama fatigue (${heavyDramaCount} films)`,
        );
      }
      return {
        type: "heavy-drama",
        count: heavyDramaCount,
        message:
          "You’ve been on a serious streak. Here are some uplifting picks to refresh your palate.",
      };
    }

    return null;
  } catch (error) {
    if (isDev) console.error("[CounterProgramming] Error:", error);
    return null;
  }
}

export async function generatePalateCleanser(
  userId: string,
  fatigueType: FatigueType,
): Promise<
  Array<{
    id: number;
    title: string;
    year?: string;
    reasons: string[];
    poster_path?: string | null;
    score: number;
    trailerKey?: string | null;
    voteCategory?: "hidden-gem" | "crowd-pleaser" | "cult-classic" | "standard";
    collectionName?: string;
    genres?: string[];
    vote_average?: number;
    vote_count?: number;
    overview?: string;
    contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
    dismissed?: boolean;
    imdb_rating?: string;
    imdb_source?: "omdb" | "tmdb" | "watchmode" | "tuimdb";
    rotten_tomatoes?: string;
    metacritic?: string;
    awards?: string;
    sources?: string[];
    consensusLevel?: "high" | "medium" | "low";
    reliabilityMultiplier?: number;
    runtime?: number;
    original_language?: string;
    spoken_languages?: string[];
    production_countries?: string[];
    streamingSources?: Array<{
      name: string;
      type: "sub" | "buy" | "rent" | "free";
      url?: string;
    }>;
  }>
> {
  try {
    const client = supabase;
    if (!client) return [];

    const recentMovies = await getRecentDiaryMovies(userId, 10);
    const mono = detectMonoGenreFatigue(recentMovies);
    const fatiguedGenre = mono?.genre;

    const topGenres = await getUserTopGenres(userId);
    const preferredGenres = topGenres.map((g) => g.name);

    const targetGenres: string[] = (() => {
      if (fatigueType === "mono-genre") {
        const fallback = [...LIGHT_GENRES];
        const nextGenres = topGenres.slice(1, 3).map((g) => g.name);
        return nextGenres.length > 0 ? nextGenres : fallback;
      }
      if (fatigueType === "intensity") return [...LIGHT_GENRES];
      return ["Comedy", "Adventure", "Fantasy", "Animation"];
    })();

    const fatiguedGenres: string[] = (() => {
      if (fatigueType === "mono-genre" && fatiguedGenre) return [fatiguedGenre];
      if (fatigueType === "intensity") return [...HIGH_INTENSITY_GENRES];
      return [...HEAVY_GENRES, "Drama"];
    })();

    const fatiguedSet = toLowerSet(fatiguedGenres);
    const targetSet = toLowerSet(targetGenres);
    const preferredSet = toLowerSet(preferredGenres);

    const { data: mappedIds } = await client
      .from("film_tmdb_map")
      .select("tmdb_id")
      .eq("user_id", userId);
    const watchedIds = new Set(
      (mappedIds || [])
        .map((row) => row.tmdb_id)
        .filter((id): id is number => typeof id === "number"),
    );

    const { count } = await client
      .from("tmdb_movies")
      .select("*", { count: "exact", head: true });

    const totalMovies = count || 5000;
    const batchSize = 250;
    const batches = 4;
    // NOTE: Random sampling trades precision for speed on large tables.
    const batchPromises = Array.from({ length: batches }, () => {
      const offset = Math.floor(
        Math.random() * Math.max(0, totalMovies - batchSize),
      );
      return client
        .from("tmdb_movies")
        .select("tmdb_id, data")
        .range(offset, offset + batchSize - 1);
    });

    const batchResults = await Promise.all(batchPromises);
    const candidateRows = batchResults.flatMap((result) => result.data || []);

    const candidates = candidateRows
      .map((row) => ({
        tmdbId: row.tmdb_id as number,
        data: row.data as Record<string, unknown>,
      }))
      .filter((row) => Number.isFinite(row.tmdbId));

    const scored = [] as Array<{
      tmdbId: number;
      data: Record<string, unknown>;
      score: number;
      reasons: string[];
    }>;

    for (const candidate of candidates) {
      if (!candidate.data) continue;
      if (watchedIds.has(candidate.tmdbId)) continue;

      const genres = getGenresFromMovieData(candidate.data);
      const lowerGenres = toLowerSet(genres);

      if (!genres.some((g) => targetSet.has(g.toLowerCase()))) continue;
      if ([...fatiguedSet].some((g) => lowerGenres.has(g))) continue;

      const voteAverage = getVoteAverageFromMovieData(candidate.data) ?? 0;
      const runtime = getRuntimeFromMovieData(candidate.data) ?? 0;

      const baseScore = voteAverage;
      const ratingBonus = voteAverage >= 7 ? 0.6 : 0;
      const runtimeBonus = runtime > 0 && runtime < 120 ? 0.4 : 0;
      const preferenceBonus = genres.some((g) =>
        preferredSet.has(g.toLowerCase()),
      )
        ? 0.3
        : 0;

      const score = baseScore + ratingBonus + runtimeBonus + preferenceBonus;

      const reasons = [
        `Palate cleanser: ${genres.find((g) => targetSet.has(g.toLowerCase())) || "Fresh pick"}`,
      ];
      if (runtime > 0 && runtime < 120) reasons.push("Short and sweet");
      if (voteAverage >= 7) reasons.push("Highly rated");

      scored.push({
        tmdbId: candidate.tmdbId,
        data: candidate.data,
        score,
        reasons,
      });
    }

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => {
        const data = entry.data as {
          title?: string;
          release_date?: string;
          poster_path?: string | null;
          overview?: string;
          vote_average?: number;
          vote_count?: number;
          genres?: Array<{ name?: string }>;
          runtime?: number;
          original_language?: string;
        };
        return {
          id: entry.tmdbId,
          title: data.title || `#${entry.tmdbId}`,
          year: data.release_date?.slice(0, 4),
          reasons: entry.reasons,
          poster_path: data.poster_path ?? null,
          score: entry.score,
          voteCategory: "standard" as const,
          genres: (data.genres || [])
            .map((g) => g.name)
            .filter(Boolean) as string[],
          vote_average: data.vote_average,
          vote_count: data.vote_count,
          overview: data.overview,
          runtime: data.runtime,
          original_language: data.original_language,
        };
      });

    if (isDev) {
      console.log(
        `[CounterProgramming] Generated ${results.length} palate cleansers (${targetGenres.join(
          ", ",
        )})`,
      );
    }

    return results;
  } catch (error) {
    if (isDev) console.error("[CounterProgramming] Error:", error);
    return [];
  }
}

export { HIGH_INTENSITY_GENRES, LIGHT_GENRES, HEAVY_GENRES };
