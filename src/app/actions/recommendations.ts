'use server';

import {
  adaptWebRecommendationIntent,
  adaptCanonicalResultToWeb,
  extractCachedWebRecommendationMetadata,
  getWebTmdbGenreFilterNames,
  getWebTmdbRetrievalGenreNames,
  matchesWebTmdbGenreFilter,
  normalizeWebRecommendationCount,
} from "@/lib/recommendationAdapters";
import type {
  WebRecommendationDetails,
  WebRecommendationItem,
} from "@/lib/recommendationAdapters";
import {
  createDeterministicRng,
  normalizeProviderFamilies,
} from "@/lib/recommendationCandidates";
import { loadRecommendationContext } from "@/lib/recommendationContext";
import {
  scoreRecommendationsWithOverlap,
  type TMDBMovie,
} from "@/lib/enrich";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import {
    buildTasteProfileServer,
    ensureCompleteTmdbDetails,
    generateServerCandidates,
    getUserContextDiagnostics,
    loadCachedTmdbDetails,
    loadUserContext,
    runCanonicalServerRecommendations,
} from "@/lib/serverSuggestionsEngine";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { RecommendationDiagnostics } from "@/lib/recommendationTypes";

export type CanonicalWebRecommendationItem = WebRecommendationItem;

export async function generateCanonicalWebRecommendations(params: {
    accessToken: string;
    count: number;
    seedTmdbIds?: number[];
    excludeTmdbIds?: number[];
    genreNames?: string[];
    requestSeed: string;
}): Promise<{
    items: CanonicalWebRecommendationItem[];
    diagnostics: RecommendationDiagnostics;
}> {
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
    const userContext = await loadUserContext(userId);
    const contextDiagnostics = getUserContextDiagnostics(userContext);
    if (
        contextDiagnostics.mode === "degraded" ||
        contextDiagnostics.inputHealth.blocked.health === "failed"
    ) {
        throw new Error("Recommendation inputs are temporarily unavailable");
    }
    const canonicalContext = await loadRecommendationContext(
        { loadUserContext: async () => userContext },
        userId,
    );
    const tasteProfile = await buildTasteProfileServer(userId, userContext);
    const adapted = adaptWebRecommendationIntent({
        userId,
        seedTmdbIds: params.seedTmdbIds ?? [],
        limit: normalizeWebRecommendationCount(params.count),
        excludeTmdbIds: params.excludeTmdbIds ?? [],
        genreNames: params.genreNames ?? [],
        context: { mode: "neutral", localHour: null },
        requestSeed: params.requestSeed,
    });
    const scoringWindowSize = Math.min(
        300,
        Math.max(adapted.request.count * 3, 100),
    );
    let requestDetails = new Map<number, TMDBMovie>();
    const requestedGenreFilterNames = getWebTmdbGenreFilterNames(
        adapted.request.genres,
    );
    const requestedRetrievalGenreNames = getWebTmdbRetrievalGenreNames(
        adapted.request.genres,
    );
    const requestedTopGenres = Object.entries(TMDB_GENRE_MAP)
        .filter(([, name]) =>
            requestedRetrievalGenreNames.includes(name.toLowerCase()),
        )
        .map(([id, name]) => ({
            id: Number(id),
            name,
            weight: 1,
            count: 1,
        }));
    const requestedGenreIds = new Set(
        requestedTopGenres.map((genre) => genre.id),
    );
    const retrievalTasteProfile =
        requestedTopGenres.length > 0
            ? {
                  ...tasteProfile,
                  topGenres: [
                      ...requestedTopGenres,
                      ...tasteProfile.topGenres.filter(
                          (genre) => !requestedGenreIds.has(genre.id),
                      ),
                  ],
              }
            : tasteProfile;
    let sourceMetadata = new Map<
        number,
        { sources: string[]; consensusLevel: "high" | "medium" | "low" }
    >();

    const result = await runCanonicalServerRecommendations(adapted.request, {
        loadContext: async () => canonicalContext,
        retrieveCandidates: async () => {
            const generated = await generateServerCandidates(
                userId,
                userContext,
                retrievalTasteProfile,
                adapted.request.seeds,
                { requestSeed: params.requestSeed },
            );
            sourceMetadata = generated.sourceMetadata;
            const scoringWindowIds = Array.from(
                new Set(generated.candidateIds),
            ).slice(0, scoringWindowSize);
            const cachedCandidateDetails = await loadCachedTmdbDetails(
                scoringWindowIds,
            );
            requestDetails = await ensureCompleteTmdbDetails(
                scoringWindowIds,
                cachedCandidateDetails,
            );
            return scoringWindowIds
                .filter((tmdbId) => requestDetails.has(tmdbId))
                .filter((tmdbId) => {
                    if (requestedGenreFilterNames.length === 0) return true;
                    return matchesWebTmdbGenreFilter(
                        (requestDetails.get(tmdbId)?.genres ?? []).map(
                            (genre) => genre.name,
                        ),
                        requestedGenreFilterNames,
                    );
                })
                .map((tmdbId) => ({ tmdbId }));
        },
        scoreCandidates: async (scoreParams) => {
            const scored = await scoreRecommendationsWithOverlap(
                scoreParams,
                requestDetails,
            );
            return scored.map((candidate) => {
                const rawSources = sourceMetadata.get(candidate.tmdbId)?.sources;
                if (!rawSources?.length) return candidate;
                return {
                    ...candidate,
                    evidence: {
                        ...candidate.evidence,
                        providerFamilies: normalizeProviderFamilies(rawSources),
                        providerOccurrences: rawSources.length,
                    },
                };
            });
        },
        rerankCandidates: async ({ candidates }) => candidates,
        rng: createDeterministicRng,
        telemetry: () => undefined,
    });

    if (!result || !Array.isArray(result.results)) {
        throw new Error("Canonical recommendation result is invalid");
    }

    const finalTmdbIds = result.results.map((candidate) => candidate.tmdbId);
    const unresolvedFinalTmdbIds = finalTmdbIds.filter(
        (tmdbId) => !requestDetails.has(tmdbId),
    );
    if (unresolvedFinalTmdbIds.length > 0) {
        const cachedDetails = await loadCachedTmdbDetails(
            unresolvedFinalTmdbIds,
        );
        const completedDetails = await ensureCompleteTmdbDetails(
            unresolvedFinalTmdbIds,
            cachedDetails,
        );
        for (const [tmdbId, movie] of completedDetails) {
            requestDetails.set(tmdbId, movie);
        }
    }
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
                richMovie?.keywords?.keywords ?? richMovie?.keywords?.results ?? []
            ).map((keyword) => keyword.name),
        });
    }
    const items: CanonicalWebRecommendationItem[] = adaptCanonicalResultToWeb(
        result,
        detailsForWeb,
    );

    return { items, diagnostics: result.diagnostics };
}

/**
 * Server Action to fetch aggregated recommendations
 * This runs on the server to securely access API keys for TasteDive, Watchmode, etc.
 */
