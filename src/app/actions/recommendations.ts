"use server";

import {
  adaptCanonicalResultToWebEnvelope,
  extractCachedWebRecommendationMetadata,
  normalizeWebRecommendationCount,
} from "@/lib/recommendationAdapters";
import type { WebRecommendationDetails } from "@/lib/recommendationAdapters";
import { createDeterministicRng } from "@/lib/recommendationCandidates";
import { loadRecommendationContext } from "@/lib/recommendationContext";
import {
  buildWebRecommendationDependencies,
  RecommendationMetadataUnavailableError,
  runWebRecommendationGeneration,
} from "@/lib/recommendationGeneration";
import { scoreRecommendationsWithOverlapStaged } from "@/lib/recommendationScoring";
import { decideRecommendationInputPreflight } from "@/lib/recommendationTypes";
import type { TMDBMovie } from "@/lib/enrich";
import {
  WEB_METADATA_DEADLINE_MS,
  buildTasteProfileServer,
  ensureCompleteTmdbDetails,
  generateServerCandidates,
  getUserContextDiagnostics,
  isMetadataCompletionHealthy,
  loadCachedTmdbDetails,
  loadUserContext,
  resolveServerRecommendationExperimentAssignment,
} from "@/lib/serverSuggestionsEngine";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createMetadataUnavailableRecommendationResult,
  type CanonicalWebRecommendationSuccess,
  type CanonicalWebRecommendationResult,
} from "@/lib/recommendationActionTypes";

type GenerateCanonicalWebRecommendationsParams = {
  accessToken: string;
  count: number;
  seedTmdbIds?: number[];
  excludeTmdbIds?: number[];
  genreNames?: string[];
  requestSeed: string;
};

async function generateCanonicalWebRecommendationsInternal(
  params: GenerateCanonicalWebRecommendationsParams,
): Promise<CanonicalWebRecommendationSuccess> {
  if (
    typeof params.accessToken !== "string" ||
    params.accessToken.length < 20 ||
    params.accessToken.length > 4096
  ) {
    throw new Error("Authentication required");
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(params.accessToken);
  if (error || !data.user) {
    throw new Error("Authentication required");
  }

  const userId = data.user.id;
  // Checkpoint 3.1A: resolve the frozen A/A assignment once after auth. The
  // resolver fails closed to the default assignment and never throws, so
  // recommendation generation always continues unchanged.
  const experimentAssignment =
    await resolveServerRecommendationExperimentAssignment(userId);
  const userContext = await loadUserContext(userId);
  const contextDiagnostics = getUserContextDiagnostics(userContext);
  const preflight = decideRecommendationInputPreflight({
    mode: contextDiagnostics.mode,
    blockedHealth: contextDiagnostics.inputHealth.blocked.health,
  });
  if (preflight.web.rejected) {
    throw new Error("Recommendation inputs are temporarily unavailable");
  }
  const canonicalContext = await loadRecommendationContext(
    { loadUserContext: async () => userContext },
    userId,
  );
  const tasteProfile = await buildTasteProfileServer(userId, userContext);
  const webIntent = {
    userId,
    seedTmdbIds: params.seedTmdbIds ?? [],
    limit: normalizeWebRecommendationCount(params.count),
    excludeTmdbIds: params.excludeTmdbIds ?? [],
    genreNames: params.genreNames ?? [],
    context: { mode: "neutral", localHour: null },
    requestSeed: params.requestSeed,
  } as const;
  const preparation = buildWebRecommendationDependencies({
    intent: webIntent,
    context: canonicalContext,
    userContext,
    tasteProfile,
    retrieveCandidates: ({
      userId: retrievalUserId,
      userContext: retrievalUserContext,
      tasteProfile: retrievalTasteProfile,
      seeds,
      requestSeed,
    }) =>
      generateServerCandidates(
        retrievalUserId,
        retrievalUserContext,
        retrievalTasteProfile,
        seeds,
        { requestSeed },
      ),
    loadCachedDetails: loadCachedTmdbDetails,
    ensureCompleteDetails: ensureCompleteTmdbDetails,
    isMetadataCompletionHealthy,
    metadataDeadlineMs: WEB_METADATA_DEADLINE_MS,
    scoreCandidates: scoreRecommendationsWithOverlapStaged,
    rng: createDeterministicRng,
    telemetry: () => undefined,
  });

  const result = await runWebRecommendationGeneration(
    webIntent,
    preparation.dependencies,
  );

  if (!result || !Array.isArray(result.results)) {
    throw new Error("Canonical recommendation result is invalid");
  }

  const { details: requestDetails, sourceMetadata } =
    await preparation.completeResult(result);
  const detailsForWeb = new Map<number, WebRecommendationDetails>();
  for (const candidate of result.results) {
    const movie = requestDetails.get(candidate.tmdbId);
    const richMovie = movie as
      | (NonNullable<typeof movie> & {
          runtime?: number;
          original_language?: string;
          reasons?: string[];
          explanation?: string;
        })
      | undefined;
    const metadata = extractCachedWebRecommendationMetadata(richMovie);
    const videos = richMovie?.videos?.results ?? [];
    const trailer =
      videos.find(
        (video) =>
          video.site === "YouTube" &&
          video.type === "Trailer" &&
          video.official,
      ) ??
      videos.find(
        (video) => video.site === "YouTube" && video.type === "Trailer",
      );
    const source = sourceMetadata.get(candidate.tmdbId);
    detailsForWeb.set(candidate.tmdbId, {
      title: richMovie?.title,
      releaseDate: richMovie?.release_date,
      posterPath: richMovie?.poster_path,
      trailerKey: trailer?.key ?? null,
      collectionName: richMovie?.belongs_to_collection?.name,
      voteCategory: metadata.voteCategory,
      genres: (richMovie?.genres ?? []).map((genre) => genre.name),
      voteAverage: richMovie?.vote_average,
      voteCount: richMovie?.vote_count,
      overview: richMovie?.overview,
      sources: source?.sources,
      consensusLevel: source?.consensusLevel,
      runtime: richMovie?.runtime,
      originalLanguage: richMovie?.original_language,
      criticScore: metadata.criticScore,
      imdbRating: metadata.imdbRating,
      rottenTomatoes: metadata.rottenTomatoes,
      metacritic: metadata.metacritic,
      reasons: richMovie?.reasons,
      explanation: richMovie?.explanation,
      spokenLanguages: (richMovie?.spoken_languages ?? [])
        .map((language) => language.english_name ?? language.name)
        .filter((name): name is string => Boolean(name)),
      productionCountries: (richMovie?.production_countries ?? [])
        .map((country) => country.name)
        .filter((name): name is string => Boolean(name)),
      keywordNames: (
        richMovie?.keywords?.keywords ??
        richMovie?.keywords?.results ??
        []
      ).map((keyword) => keyword.name),
    });
  }
  const { items, trace } = adaptCanonicalResultToWebEnvelope(
    result,
    detailsForWeb,
    {
      experimentAssignment,
      inputRevisionMaterial: canonicalContext.revisionMaterial,
    },
  );

  // The envelope builds and validates this trace via the shared builder, so
  // every successful web result carries the identical canonical diagnostic
  // structure plus the complete experiment assignment.
  // preRanks serializes the bounded engine pre-rank map into seam-safe tuples.
  return {
    items,
    diagnostics: result.diagnostics,
    trace,
    preRanks: [...result.preRanksById.entries()],
  };
}

export async function generateCanonicalWebRecommendations(
  params: GenerateCanonicalWebRecommendationsParams,
): Promise<CanonicalWebRecommendationResult> {
  try {
    return await generateCanonicalWebRecommendationsInternal(params);
  } catch (error) {
    if (error instanceof RecommendationMetadataUnavailableError) {
      return createMetadataUnavailableRecommendationResult();
    }
    throw error;
  }
}

/**
 * Server Action to fetch aggregated recommendations
 * This runs on the server to securely access API keys for TasteDive, Watchmode, etc.
 */
