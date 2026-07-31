const MAX_RESTORED_ARRAY_LENGTH = 300;
const PAIRWISE_SESSION_LIMIT = 5;
const SHOWN_IDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SuggestionStorageKeys = {
  items: string;
  shownIds: string;
  pairHistory: string;
  pairwiseCount: string;
};

export type StoredSuggestionItem = {
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
  critic_score?: number;
  explanation?: string;
  spoken_languages?: string[];
  production_countries?: string[];
  streamingSources?: Array<{
    name: string;
    type: "sub" | "buy" | "rent" | "free";
    url?: string;
  }>;
  keyword_names?: string[];
};

const VOTE_CATEGORIES = [
  "hidden-gem",
  "crowd-pleaser",
  "cult-classic",
  "standard",
] as const;
const IMDB_SOURCES = ["omdb", "tmdb", "watchmode", "tuimdb"] as const;
const CONSENSUS_LEVELS = ["high", "medium", "low"] as const;
const STREAMING_SOURCE_TYPES = ["sub", "buy", "rent", "free"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | null): unknown | null {
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value as Values[number]);
}

function sanitizeStreamingSources(
  value: unknown,
): StoredSuggestionItem["streamingSources"] | null {
  if (!Array.isArray(value)) return null;

  const sanitized: NonNullable<StoredSuggestionItem["streamingSources"]> = [];
  for (const source of value) {
    if (
      !isRecord(source) ||
      typeof source.name !== "string" ||
      !isOneOf(source.type, STREAMING_SOURCE_TYPES)
    ) {
      return null;
    }

    const sanitizedSource: NonNullable<
      StoredSuggestionItem["streamingSources"]
    >[number] = {
      name: source.name,
      type: source.type,
    };

    if (hasOwn(source, "url")) {
      if (typeof source.url !== "string") return null;
      sanitizedSource.url = source.url;
    }

    sanitized.push(sanitizedSource);
  }

  return sanitized;
}

function sanitizeContributingFilms(
  value: unknown,
): StoredSuggestionItem["contributingFilms"] | null {
  if (!isRecord(value)) return null;

  const groups: Array<
    [string, Array<{ id: number; title: string }>]
  > = [];
  for (const [group, films] of Object.entries(value)) {
    if (!Array.isArray(films)) return null;

    const sanitizedFilms: Array<{ id: number; title: string }> = [];
    for (const film of films) {
      if (
        !isRecord(film) ||
        !isPositiveInteger(film.id) ||
        typeof film.title !== "string"
      ) {
        return null;
      }

      sanitizedFilms.push({ id: film.id, title: film.title });
    }

    groups.push([group, sanitizedFilms]);
  }

  return Object.fromEntries(groups);
}

function sanitizeStoredSuggestionItem(
  item: Record<string, unknown>,
): StoredSuggestionItem | null {
  if (
    !isPositiveInteger(item.id) ||
    typeof item.title !== "string" ||
    !isStringArray(item.reasons) ||
    !isFiniteNumber(item.score)
  ) {
    return null;
  }

  const sanitized: StoredSuggestionItem = {
    id: item.id,
    title: item.title,
    reasons: item.reasons.slice(),
    score: item.score,
  };

  if (hasOwn(item, "year")) {
    if (typeof item.year !== "string") return null;
    sanitized.year = item.year;
  }
  if (hasOwn(item, "collectionName")) {
    if (typeof item.collectionName !== "string") return null;
    sanitized.collectionName = item.collectionName;
  }
  if (hasOwn(item, "overview")) {
    if (typeof item.overview !== "string") return null;
    sanitized.overview = item.overview;
  }
  if (hasOwn(item, "imdb_rating")) {
    if (typeof item.imdb_rating !== "string") return null;
    sanitized.imdb_rating = item.imdb_rating;
  }
  if (hasOwn(item, "rotten_tomatoes")) {
    if (typeof item.rotten_tomatoes !== "string") return null;
    sanitized.rotten_tomatoes = item.rotten_tomatoes;
  }
  if (hasOwn(item, "metacritic")) {
    if (typeof item.metacritic !== "string") return null;
    sanitized.metacritic = item.metacritic;
  }
  if (hasOwn(item, "awards")) {
    if (typeof item.awards !== "string") return null;
    sanitized.awards = item.awards;
  }
  if (hasOwn(item, "original_language")) {
    if (typeof item.original_language !== "string") return null;
    sanitized.original_language = item.original_language;
  }
  if (hasOwn(item, "explanation")) {
    if (typeof item.explanation !== "string") return null;
    sanitized.explanation = item.explanation;
  }
  if (hasOwn(item, "poster_path")) {
    if (item.poster_path !== null && typeof item.poster_path !== "string") {
      return null;
    }
    sanitized.poster_path = item.poster_path;
  }
  if (hasOwn(item, "trailerKey")) {
    if (item.trailerKey !== null && typeof item.trailerKey !== "string") {
      return null;
    }
    sanitized.trailerKey = item.trailerKey;
  }
  if (hasOwn(item, "vote_average")) {
    if (!isFiniteNumber(item.vote_average)) return null;
    sanitized.vote_average = item.vote_average;
  }
  if (hasOwn(item, "vote_count")) {
    if (!isFiniteNumber(item.vote_count)) return null;
    sanitized.vote_count = item.vote_count;
  }
  if (hasOwn(item, "reliabilityMultiplier")) {
    if (!isFiniteNumber(item.reliabilityMultiplier)) return null;
    sanitized.reliabilityMultiplier = item.reliabilityMultiplier;
  }
  if (hasOwn(item, "runtime")) {
    if (!isFiniteNumber(item.runtime)) return null;
    sanitized.runtime = item.runtime;
  }
  if (hasOwn(item, "critic_score")) {
    if (!isFiniteNumber(item.critic_score)) return null;
    sanitized.critic_score = item.critic_score;
  }
  if (hasOwn(item, "dismissed")) {
    if (typeof item.dismissed !== "boolean") return null;
    sanitized.dismissed = item.dismissed;
  }
  if (hasOwn(item, "voteCategory")) {
    if (!isOneOf(item.voteCategory, VOTE_CATEGORIES)) return null;
    sanitized.voteCategory = item.voteCategory;
  }
  if (hasOwn(item, "imdb_source")) {
    if (!isOneOf(item.imdb_source, IMDB_SOURCES)) return null;
    sanitized.imdb_source = item.imdb_source;
  }
  if (hasOwn(item, "consensusLevel")) {
    if (!isOneOf(item.consensusLevel, CONSENSUS_LEVELS)) return null;
    sanitized.consensusLevel = item.consensusLevel;
  }
  if (hasOwn(item, "genres")) {
    if (!isStringArray(item.genres)) return null;
    sanitized.genres = item.genres.slice();
  }
  if (hasOwn(item, "sources")) {
    if (!isStringArray(item.sources)) return null;
    sanitized.sources = item.sources.slice();
  }
  if (hasOwn(item, "spoken_languages")) {
    if (!isStringArray(item.spoken_languages)) return null;
    sanitized.spoken_languages = item.spoken_languages.slice();
  }
  if (hasOwn(item, "production_countries")) {
    if (!isStringArray(item.production_countries)) return null;
    sanitized.production_countries = item.production_countries.slice();
  }
  if (hasOwn(item, "keyword_names")) {
    if (!isStringArray(item.keyword_names)) return null;
    sanitized.keyword_names = item.keyword_names.slice();
  }
  if (hasOwn(item, "streamingSources")) {
    const streamingSources = sanitizeStreamingSources(item.streamingSources);
    if (!streamingSources) return null;
    sanitized.streamingSources = streamingSources;
  }
  if (hasOwn(item, "contributingFilms")) {
    const contributingFilms = sanitizeContributingFilms(item.contributingFilms);
    if (!contributingFilms) return null;
    sanitized.contributingFilms = contributingFilms;
  }

  return sanitized;
}

export function getSuggestionStorageKeys(
  userId: string | null,
): SuggestionStorageKeys | null {
  if (typeof userId !== "string" || userId.trim().length === 0) return null;

  return {
    items: `lettrsuggest:${userId}:items`,
    shownIds: `lettrsuggest:${userId}:shown_ids`,
    pairHistory: `lettrsuggest:${userId}:pair_history`,
    pairwiseCount: `lettrsuggest:${userId}:pairwise_count`,
  };
}

export function parseStoredSuggestionItems(
  value: string | null,
): StoredSuggestionItem[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const sanitized: StoredSuggestionItem[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) return null;

    const sanitizedItem = sanitizeStoredSuggestionItem(item);
    if (!sanitizedItem) return null;
    sanitized.push(sanitizedItem);
  }

  return sanitized.slice(0, MAX_RESTORED_ARRAY_LENGTH);
}

export function parseStoredShownIds(
  value: string | null,
  now = Date.now(),
): number[] | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;

  const { ids, timestamp } = parsed;
  if (
    !Array.isArray(ids) ||
    !ids.every(isPositiveInteger) ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(now) ||
    timestamp > now ||
    now - timestamp >= SHOWN_IDS_TTL_MS
  ) {
    return null;
  }

  return ids.slice(0, MAX_RESTORED_ARRAY_LENGTH);
}

export function parseStoredPairHistory(value: string | null): string[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || !parsed.every((pair) => typeof pair === "string")) {
    return null;
  }

  return parsed.slice(0, MAX_RESTORED_ARRAY_LENGTH);
}

export function parseStoredPairwiseCount(value: string | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;

  const count = Number(value);
  if (
    !Number.isFinite(count) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > PAIRWISE_SESSION_LIMIT
  ) {
    return null;
  }

  return count;
}
