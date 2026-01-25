import { getBulkTmdbDetails, getFilmMappings } from "@/lib/enrich";
import { supabase } from "@/lib/supabaseClient";

export type GenreDistribution = Record<string, number>;

export type CalibrationConfig = {
  strength?: number; // 0-1, default 0.7
  minCandidatesPerGenre?: number; // default 1
};

type CalibratableMovie = {
  id: number;
  score: number;
  genres?: string[];
};

const DEFAULT_CALIBRATION_STRENGTH = 0.7;
const DEFAULT_MIN_PER_GENRE = 1;
const DEFAULT_TARGET_COUNT = 20;
const MAX_GENRES_FOR_DISTRIBUTION = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeGenre = (genre: string) => genre.trim();

const formatDistributionForLog = (distribution: GenreDistribution) =>
  Object.fromEntries(
    Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, ratio]) => [genre, `${Math.round(ratio * 100)}%`]),
  );

const countGenres = <T extends CalibratableMovie>(
  items: T[],
  distribution: GenreDistribution,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const genre = pickPrimaryGenre(item.genres, distribution);
    counts[genre] = (counts[genre] ?? 0) + 1;
  });
  return counts;
};

const pickPrimaryGenre = (
  genres: string[] | undefined,
  distribution: GenreDistribution,
) => {
  if (!genres || genres.length === 0) return "Other";
  const normalized = genres.map(normalizeGenre);
  if (normalized.length === 1) return normalized[0];
  let best = normalized[0];
  let bestWeight = distribution[best] ?? 0;
  for (const genre of normalized) {
    const weight = distribution[genre] ?? 0;
    if (weight > bestWeight) {
      best = genre;
      bestWeight = weight;
    }
  }
  return best;
};

const deriveDistributionFromLikedFilms = async (
  userId: string,
): Promise<GenreDistribution | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("film_events")
      .select("uri, rating, liked")
      .eq("user_id", userId)
      .limit(500);

    if (error) {
      console.error("[Calibration] Failed to fetch film events", error);
      return null;
    }

    const likedUris = (data ?? [])
      .filter((row) => {
        const rating = typeof row.rating === "number" ? row.rating : null;
        return Boolean(row.liked) || (rating != null && rating >= 3);
      })
      .map((row) => row.uri)
      .filter((uri): uri is string => Boolean(uri));

    if (likedUris.length === 0) return null;

    const mappings = await getFilmMappings(userId, likedUris);
    const tmdbIds = Array.from(
      new Set(
        likedUris
          .map((uri) => mappings.get(uri))
          .filter((id): id is number => typeof id === "number"),
      ),
    );

    if (tmdbIds.length === 0) return null;

    const detailsMap = await getBulkTmdbDetails(tmdbIds);
    if (detailsMap.size === 0) return null;

    const genreCounts = new Map<string, number>();
    let totalFilms = 0;

    tmdbIds.forEach((tmdbId) => {
      const movie = detailsMap.get(tmdbId);
      if (!movie) return;
      totalFilms += 1;

      const rawGenres = (movie.genres || [])
        .map((g: { name: string }) => g.name)
        .filter(Boolean);

      if (rawGenres.length === 0) {
        genreCounts.set("Other", (genreCounts.get("Other") || 0) + 1);
        return;
      }

      const share = 1 / rawGenres.length;
      rawGenres.forEach((genre) => {
        const key = normalizeGenre(genre);
        genreCounts.set(key, (genreCounts.get(key) || 0) + share);
      });
    });

    if (totalFilms === 0 || genreCounts.size === 0) return null;

    const entries = Array.from(genreCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    const trimmedEntries = entries.slice(0, MAX_GENRES_FOR_DISTRIBUTION);
    const otherEntries = entries.slice(MAX_GENRES_FOR_DISTRIBUTION);
    const otherCount = otherEntries.reduce((sum, [, count]) => sum + count, 0);
    if (otherCount > 0) {
      trimmedEntries.push(["Other", otherCount]);
    }

    const totalCount = trimmedEntries.reduce(
      (sum, [, count]) => sum + count,
      0,
    );
    if (totalCount <= 0) return null;

    const distribution: GenreDistribution = {};
    trimmedEntries.forEach(([genre, count]) => {
      distribution[genre] = count / totalCount;
    });

    return distribution;
  } catch (error) {
    console.error("[Calibration] Failed to derive distribution", error);
    return null;
  }
};

const buildTargetCounts = <T extends CalibratableMovie>(
  buckets: Map<string, T[]>,
  distribution: GenreDistribution,
  targetCount: number,
  minCandidatesPerGenre: number,
) => {
  const bucketEntries = Array.from(buckets.entries()).filter(
    ([, items]) => items.length > 0,
  );

  const weightedGenres = bucketEntries.map(([genre]) => {
    if (genre === "Other") {
      return { genre, weight: distribution[genre] ?? 0 };
    }
    return { genre, weight: distribution[genre] ?? 0 };
  });

  const totalWeight = weightedGenres.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );

  if (totalWeight === 0) {
    return new Map(
      bucketEntries.map(([genre, items]) => [genre, Math.min(items.length, 0)]),
    );
  }

  const rawTargets = weightedGenres.map((entry) => ({
    ...entry,
    raw: (entry.weight / totalWeight) * targetCount,
  }));

  const baseTargets = new Map<string, number>();
  rawTargets.forEach((entry) => {
    baseTargets.set(entry.genre, Math.floor(entry.raw));
  });

  if (minCandidatesPerGenre > 0) {
    rawTargets.forEach((entry) => {
      if (entry.weight <= 0) return;
      const current = baseTargets.get(entry.genre) ?? 0;
      baseTargets.set(entry.genre, Math.max(current, minCandidatesPerGenre));
    });
  }

  let totalBase = Array.from(baseTargets.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  if (totalBase > targetCount) {
    const byLowestWeight = [...rawTargets].sort((a, b) => a.weight - b.weight);
    for (const entry of byLowestWeight) {
      if (totalBase <= targetCount) break;
      const current = baseTargets.get(entry.genre) ?? 0;
      if (current > 0) {
        baseTargets.set(entry.genre, current - 1);
        totalBase -= 1;
      }
    }
  }

  let remainder = targetCount - totalBase;
  const fractional = rawTargets
    .map((entry) => ({
      genre: entry.genre,
      fraction: entry.raw - Math.floor(entry.raw),
    }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const entry of fractional) {
    if (remainder <= 0) break;
    baseTargets.set(entry.genre, (baseTargets.get(entry.genre) ?? 0) + 1);
    remainder -= 1;
  }

  const targets = new Map<string, number>();
  bucketEntries.forEach(([genre, items]) => {
    const desired = baseTargets.get(genre) ?? 0;
    targets.set(genre, Math.min(desired, items.length));
  });

  return targets;
};

const calibrateByDistribution = <T extends CalibratableMovie>(
  candidates: T[],
  distribution: GenreDistribution,
  targetCount: number,
  minCandidatesPerGenre: number,
) => {
  const pool = candidates.slice(0, targetCount);
  const buckets = new Map<string, T[]>();
  pool.forEach((item) => {
    const genre = pickPrimaryGenre(item.genres, distribution);
    const bucket = buckets.get(genre) ?? [];
    bucket.push(item);
    buckets.set(genre, bucket);
  });

  const targets = buildTargetCounts(
    buckets,
    distribution,
    targetCount,
    minCandidatesPerGenre,
  );

  const selected: T[] = [];
  const selectedCounts = new Map<string, number>();
  let iterations = 0;
  const MAX_ITERATIONS = 1000;
  const isDev = process.env.NODE_ENV === "development";

  while (selected.length < targetCount && iterations++ < MAX_ITERATIONS) {
    const availableGenres = Array.from(buckets.entries()).filter(
      ([, items]) => items.length > 0,
    );

    if (availableGenres.length === 0) break;

    let pickGenre: string | null = null;
    let maxDeficit = -Infinity;
    let bestScore = -Infinity;

    availableGenres.forEach(([genre, items]) => {
      const target = targets.get(genre) ?? 0;
      const current = selectedCounts.get(genre) ?? 0;
      const deficit = target - current;
      const topScore = items[0]?.score ?? 0;

      if (
        deficit > maxDeficit ||
        (deficit === maxDeficit && topScore > bestScore)
      ) {
        maxDeficit = deficit;
        bestScore = topScore;
        pickGenre = genre;
      }
    });

    if (!pickGenre) break;

    if (maxDeficit <= 0) {
      // All targets met; pick highest-scoring remaining movie overall.
      const bestOverall = availableGenres
        .map(([genre, items]) => ({ genre, item: items[0] }))
        .filter((entry) => entry.item != null)
        .sort((a, b) => (b.item?.score ?? 0) - (a.item?.score ?? 0))[0];

      if (!bestOverall) break;
      pickGenre = bestOverall.genre;
    }

    const bucket = buckets.get(pickGenre) ?? [];
    const nextItem = bucket.shift();
    if (!nextItem) break;
    selected.push(nextItem);
    selectedCounts.set(pickGenre, (selectedCounts.get(pickGenre) ?? 0) + 1);
  }

  if (iterations >= MAX_ITERATIONS) {
    if (isDev) {
      console.warn("[Calibration] Hit max iterations, using partial results");
    }
  }

  if (selected.length < targetCount) {
    const selectedIds = new Set(selected.map((item) => item.id));
    for (const item of pool) {
      if (selected.length >= targetCount) break;
      if (!selectedIds.has(item.id)) {
        selected.push(item);
      }
    }
  }

  return selected;
};

const blendCalibrationOrder = <T extends CalibratableMovie>(
  originalTop: T[],
  calibratedTop: T[],
  strength: number,
) => {
  if (strength >= 1) return calibratedTop;
  if (strength <= 0) return originalTop;

  const originalRank = new Map<number, number>();
  const calibratedRank = new Map<number, number>();

  originalTop.forEach((item, index) => originalRank.set(item.id, index));
  calibratedTop.forEach((item, index) => calibratedRank.set(item.id, index));

  const blended = [...originalTop].sort((a, b) => {
    const origA = originalRank.get(a.id) ?? 0;
    const origB = originalRank.get(b.id) ?? 0;
    const calibA = calibratedRank.get(a.id) ?? originalTop.length + origA;
    const calibB = calibratedRank.get(b.id) ?? originalTop.length + origB;
    const scoreA = origA * (1 - strength) + calibA * strength;
    const scoreB = origB * (1 - strength) + calibB * strength;
    if (scoreA === scoreB) return origA - origB;
    return scoreA - scoreB;
  });

  return blended;
};

export async function calibrateRecommendations<T extends CalibratableMovie>(
  userId: string,
  candidates: T[],
  config: CalibrationConfig = {},
): Promise<T[]> {
  try {
    if (!userId || candidates.length === 0) return candidates;

    const distribution = await deriveDistributionFromLikedFilms(userId);
    if (!distribution || Object.keys(distribution).length === 0) {
      return candidates;
    }

    if (process.env.NODE_ENV === "development") {
      console.log(
        "[Calibration] User genre distribution:",
        formatDistributionForLog(distribution),
      );
    }

    const strength = clamp(
      config.strength ?? DEFAULT_CALIBRATION_STRENGTH,
      0,
      1,
    );
    const minCandidatesPerGenre =
      config.minCandidatesPerGenre ?? DEFAULT_MIN_PER_GENRE;
    const targetCount = Math.min(DEFAULT_TARGET_COUNT, candidates.length);

    const originalTop = candidates.slice(0, targetCount);
    const beforeCounts = countGenres(originalTop, distribution);

    const calibratedTop = calibrateByDistribution(
      originalTop,
      distribution,
      targetCount,
      minCandidatesPerGenre,
    );

    const afterCounts = countGenres(calibratedTop, distribution);

    if (process.env.NODE_ENV === "development") {
      console.log("[Calibration] Before/After genre counts", {
        before: beforeCounts,
        after: afterCounts,
      });
    }

    const blendedTop = blendCalibrationOrder(
      originalTop,
      calibratedTop,
      strength,
    );

    return [...blendedTop, ...candidates.slice(targetCount)];
  } catch (error) {
    console.error("[Calibration] Failed to calibrate", error);
    return candidates;
  }
}
