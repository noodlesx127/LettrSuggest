import type { buildTasteProfile } from "@/lib/enrich";
import type { FilmEvent } from "@/lib/normalize";

// ---------------------------------
// Supabase JSON helpers
// ---------------------------------

/**
 * Represents JSON values stored in Supabase JSON/JSONB columns.
 * Used for flexible payloads like recommendation sources and movie features.
 */
export type SupabaseJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: SupabaseJson }
  | SupabaseJson[];

// ---------------------------------
// TMDB data structures
// ---------------------------------

export interface Genre {
  id: number;
  name: string;
}

export interface Keyword {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  profile_path?: string;
  order?: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job?: string;
  profile_path?: string;
}

export interface ProductionCompany {
  id: number;
  name: string;
  logo_path?: string;
}

export interface TMDBCredits {
  cast?: CastMember[];
  crew?: CrewMember[];
}

export interface TMDBKeywordContainer {
  keywords?: Keyword[];
  results?: Keyword[];
}

export interface TMDBVideo {
  id: string;
  key: string;
  site: string;
  type: string;
  name: string;
  official?: boolean;
}

/**
 * TMDB details cached for stats enrichment.
 * Includes nested cast/crew/keyword structures and optional media metadata.
 */
export interface TMDBDetails {
  id: number;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  genres?: Genre[];
  production_companies?: ProductionCompany[];
  credits?: TMDBCredits;
  keywords?: TMDBKeywordContainer;
  overview?: string; // Required for subgenre detection
  vote_average?: number;
  vote_count?: number;
  videos?: {
    results?: TMDBVideo[];
  };
}

// ---------------------------------
// Stats data structures
// ---------------------------------

export interface MappingCoverage {
  mapped: number;
  total: number;
}

export interface ExplorationStats {
  exploration_rate: number;
  exploratory_films_rated: number;
  exploratory_avg_rating: number;
}

export interface AdjacentPreference {
  from_genre_name: string;
  to_genre_name: string;
  success_rate: number;
  rating_count: number;
}

export interface PairwiseStats {
  total_comparisons: number;
  recent_30d: number;
  recent_90d: number;
  high_consensus_wins: number;
  medium_consensus_wins: number;
  low_consensus_wins: number;
}

export interface FeedbackSummary {
  total: number;
  positive: number;
  negative: number;
  hitRate: number;
}

export interface SourceReliability {
  source: string;
  total: number;
  positive: number;
  hitRate: number;
}

export interface ConsensusBucket {
  pos: number;
  total: number;
}

export interface SourceConsensus {
  source: string;
  high: ConsensusBucket;
  medium: ConsensusBucket;
  low: ConsensusBucket;
}

export interface ConsensusAcceptance {
  high: ConsensusBucket;
  medium: ConsensusBucket;
  low: ConsensusBucket;
}

export interface ReasonAcceptance {
  reason: string;
  total: number;
  positive: number;
  hitRate: number;
}

export interface RepeatSuggestionStats {
  totalExposures: number;
  uniqueSuggestions: number;
  repeatRate: number;
  avgTimeBetweenRepeats: number | null;
}

/**
 * Computed taste profile returned by buildTasteProfile().
 * This is a complex, weighted preference structure used across tabs.
 */
export type TasteProfileData = Awaited<ReturnType<typeof buildTasteProfile>>;

// ---------------------------------
// Feedback row shapes
// ---------------------------------

export type ConsensusLevel = "high" | "medium" | "low";

/**
 * Raw feedback row from suggestion_feedback.
 * JSON fields are stored as Supabase JSON and normalized at runtime.
 */
export interface FeedbackRow {
  feedback_type: string;
  recommendation_sources?: SupabaseJson;
  consensus_level?: ConsensusLevel | null;
  reason_types?: SupabaseJson;
  movie_features?: SupabaseJson;
  tmdb_id?: number | null;
  created_at?: string | null;
}

// ---------------------------------
// Filter/UI types
// ---------------------------------

export type TimeFilter = "all" | "year" | "month";

export type TabValue =
  | "overview"
  | "taste"
  | "history"
  | "algorithm"
  | "watchlist"
  | "filters";

// ---------------------------------
// Component prop types
// ---------------------------------

export interface StatsTabProps {
  readonly timeFilter: TimeFilter;
  readonly filteredFilms: readonly FilmEvent[];
  readonly uid: string;
}
