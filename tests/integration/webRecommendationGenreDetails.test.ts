import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildAdjacentGenreMap: vi.fn(() => new Map()),
  buildFeatureFeedbackFromRows: vi.fn(() => ({
    avoidActors: [],
    avoidKeywords: [],
    avoidFranchises: [],
    avoidDirectors: [],
    avoidGenres: [],
    avoidSubgenres: [],
    preferActors: [],
    preferKeywords: [],
    preferDirectors: [],
    preferGenres: [],
    preferSubgenres: [],
  })),
  buildTasteProfileServer: vi.fn(),
  createDeterministicRng: vi.fn(),
  ensureCompleteTmdbDetails: vi.fn(),
  generateServerCandidates: vi.fn(),
  getUser: vi.fn(),
  getUserContextDiagnostics: vi.fn(),
  loadCachedTmdbDetails: vi.fn(),
  loadRecommendationContext: vi.fn(),
  loadUserContext: vi.fn(),
  isMetadataCompletionHealthy: vi.fn(() => true),
  runCanonicalServerRecommendations: vi.fn(),
  scoreRecommendationsWithOverlap: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/recommendationCandidates", () => ({
  createDeterministicRng: mocks.createDeterministicRng,
}));

vi.mock("@/lib/recommendationScoring", () => ({
  scoreRecommendationsWithOverlap: mocks.scoreRecommendationsWithOverlap,
  scoreRecommendationsWithOverlapStaged: mocks.scoreRecommendationsWithOverlap,
}));

vi.mock("@/lib/recommendationContext", () => ({
  loadRecommendationContext: mocks.loadRecommendationContext,
}));

vi.mock("@/lib/recommendationGeneration", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/recommendationGeneration")
  >("@/lib/recommendationGeneration");
  const { adaptWebRecommendationIntent } =
    await vi.importActual<typeof import("@/lib/recommendationAdapters")>(
      "@/lib/recommendationAdapters",
    );
  return {
    ...actual,
    runWebRecommendationGeneration: (
      intent: Parameters<typeof adaptWebRecommendationIntent>[0],
      dependencies: unknown,
    ) =>
      mocks.runCanonicalServerRecommendations(
        adaptWebRecommendationIntent(intent).request,
        dependencies,
      ),
  };
});

vi.mock("@/lib/enrich", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/enrich")>("@/lib/enrich");
  return {
    ...actual,
    scoreRecommendationsWithOverlap: mocks.scoreRecommendationsWithOverlap,
  };
});

vi.mock("@/lib/serverSuggestionsEngine", () => ({
  WEB_METADATA_DEADLINE_MS: 20_000,
  buildAdjacentGenreMap: mocks.buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows: mocks.buildFeatureFeedbackFromRows,
  buildTasteProfileServer: mocks.buildTasteProfileServer,
  ensureCompleteTmdbDetails: mocks.ensureCompleteTmdbDetails,
  generateServerCandidates: mocks.generateServerCandidates,
  getUserContextDiagnostics: mocks.getUserContextDiagnostics,
  isMetadataCompletionHealthy: mocks.isMetadataCompletionHealthy,
  loadCachedTmdbDetails: mocks.loadCachedTmdbDetails,
  loadUserContext: mocks.loadUserContext,
  runCanonicalServerRecommendations: mocks.runCanonicalServerRecommendations,
}));

import { generateCanonicalWebRecommendations } from "@/app/actions/recommendations";
import {
  isCanonicalWebRecommendationFailure,
  type CanonicalWebRecommendationResult,
} from "@/lib/recommendationActionTypes";
import { suggestByOverlap, type TMDBMovie } from "@/lib/enrich";
import { buildRecommendationTrace } from "@/lib/recommendationTelemetry";
import {
  RECOMMENDATION_ENGINE_VERSION,
  validateRecommendationTrace,
  type RecommendationDiagnostics,
} from "@/lib/recommendationTypes";

const successfulResult = (result: CanonicalWebRecommendationResult) => {
  if (isCanonicalWebRecommendationFailure(result)) {
    throw new Error(result.error.message);
  }
  return result;
};

const expectBoundedDeadline = (call: readonly unknown[]) => {
  const { deadlineMs } = call[2] as { deadlineMs: number };
  expect(Number.isFinite(deadlineMs)).toBe(true);
  expect(deadlineMs).toBeGreaterThanOrEqual(0);
  expect(deadlineMs).toBeLessThanOrEqual(20_000);
  return deadlineMs;
};

const WEB_MOCK_DIAGNOSTICS: RecommendationDiagnostics = {
  mode: "personalized",
  engineVersion: RECOMMENDATION_ENGINE_VERSION,
  contextMode: "neutral",
  inputHealth: {
    films: { health: "ok", rowCount: 1 },
    mappings: { health: "ok", rowCount: 1 },
    feedback: { health: "empty", rowCount: 0 },
    exploration: { health: "empty", rowCount: 0 },
    adjacent_genres: { health: "empty", rowCount: 0 },
    exposures: { health: "empty", rowCount: 0 },
    blocked: { health: "ok", rowCount: 0 },
  },
  failedSources: [],
  requestSeedHash: "0000000000000001",
  seedCount: 0,
  candidateCount: 0,
  resultCount: 0,
  stageCounts: { retrieval: 0, scoring: 0, reranking: 0, final: 0 },
  dropReasonCounts: {},
};
const VALID_ENGINE_TRACE = buildRecommendationTrace({
  result: { results: [], diagnostics: WEB_MOCK_DIAGNOSTICS },
});

describe("canonical web standard-genre detail completion", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "genre-user" } },
      error: null,
    });
    mocks.loadUserContext.mockResolvedValue({
      films: [],
      mappings: new Map(),
      feedback: [],
      explorationRate: 0.15,
      adjacentGenres: [],
      recentExposures: new Map(),
    });
    mocks.getUserContextDiagnostics.mockReturnValue({
      mode: "personalized",
      inputHealth: { blocked: { health: "ok" } },
    });
    mocks.loadRecommendationContext.mockResolvedValue({
      watchedTmdbIds: new Set<number>(),
      blockedTmdbIds: new Set<number>(),
    });
    mocks.buildTasteProfileServer.mockResolvedValue({ topGenres: [] });
    mocks.scoreRecommendationsWithOverlap.mockImplementation(
      async (params: { candidates: readonly { tmdbId: number }[] }) =>
        (() => {
          const candidates = params.candidates.map(({ tmdbId }, index) => ({
            tmdbId,
            score: 10 - index,
            evidence: {
              seedAnchors: [],
              providerFamilies: [],
              providerOccurrences: 0,
              retrievalScore: 1,
            },
            attribution: {
              retrieval: 1,
              preference: 0,
              context: 0,
              diversity: 0,
              total: 1,
            },
          }));
          return {
            candidates,
            rerankCandidates: () => candidates,
          };
        })(),
    );
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: [101, 202],
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails.mockResolvedValue(new Map());
    mocks.ensureCompleteTmdbDetails.mockImplementation(
      async (candidateIds: number[], cachedDetails: Map<number, unknown>) => {
        const completedDetails = new Map(cachedDetails);
        for (const tmdbId of candidateIds) {
          if (completedDetails.has(tmdbId)) continue;
          completedDetails.set(tmdbId, {
            id: tmdbId,
            title: `Movie ${tmdbId}`,
            genres: [
              {
                name: tmdbId === 101 ? "Action" : tmdbId === 202 ? "Drama" : "",
              },
            ],
          });
        }
        const requested = new Set(candidateIds).size;
        return {
          details: completedDetails,
          requested,
          completed: completedDetails.size,
          failed: requested - completedDetails.size,
          deadlineExpired: false,
        };
      },
    );
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (
        request: unknown,
        dependencies: {
          retrieveCandidates: () => Promise<Array<{ tmdbId: number }>>;
          scoreCandidates: (params: {
            request: unknown;
            context: unknown;
            mode: string;
            candidates: Array<{ tmdbId: number }>;
          }) => Promise<readonly unknown[]>;
        },
      ) => {
        const candidates = await dependencies.retrieveCandidates();
        const scored = await dependencies.scoreCandidates({
          request,
          context: {},
          mode: "personalized",
          candidates,
        });
        const count =
          typeof (request as { count?: unknown }).count === "number"
            ? (request as { count: number }).count
            : scored.length;
        const results = scored.slice(0, count);
        return {
          results,
          diagnostics: {},
          trace: VALID_ENGINE_TRACE,
          preRanksById: new Map<number, number>(
            results.map(
              (candidate, index) =>
                [
                  (candidate as { tmdbId: number }).tmdbId,
                  index + 1,
                ] as [number, number],
            ),
          ),
        };
      },
    );
  });

  it("completes uncached candidates before filtering and excludes nonmatches", async () => {
    const result = await generateCanonicalWebRecommendations({
      accessToken: "genre-action-token-1234567890",
      count: 10,
      genreNames: ["Action"],
      requestSeed: "web-genre-detail-completion",
    });

    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [101, 202],
      expect.any(Map),
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    expectBoundedDeadline(mocks.ensureCompleteTmdbDetails.mock.calls[0]);
    const cachedDetails = mocks.ensureCompleteTmdbDetails.mock
      .calls[0][1] as Map<number, unknown>;
    expect(cachedDetails.size).toBe(0);
    expect(successfulResult(result).items.map((item) => item.id)).toEqual([
      101,
    ]);
  });

  it("includes a validated canonical trace on every successful web result", async () => {
    const result = await generateCanonicalWebRecommendations({
      accessToken: "genre-action-token-1234567890",
      count: 10,
      genreNames: ["Action"],
      requestSeed: "web-trace-required",
    });

    const success = successfulResult(result);
    expect(success.trace).toBeDefined();
    expect(validateRecommendationTrace(success.trace)).toBe(true);
  });

  it("returns bounded serializable preRanks tuples preserving the engine pre-rank map", async () => {
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (
        request: unknown,
        dependencies: {
          retrieveCandidates: () => Promise<Array<{ tmdbId: number }>>;
          scoreCandidates: (params: {
            request: unknown;
            context: unknown;
            mode: string;
            candidates: Array<{ tmdbId: number }>;
          }) => Promise<readonly unknown[]>;
        },
      ) => {
        const candidates = await dependencies.retrieveCandidates();
        const scored = await dependencies.scoreCandidates({
          request,
          context: {},
          mode: "personalized",
          candidates,
        });
        return {
          results: scored,
          diagnostics: {},
          trace: VALID_ENGINE_TRACE,
          preRanksById: new Map<number, number>([
            [202, 7],
            [101, 3],
          ]),
        };
      },
    );

    const success = successfulResult(
      await generateCanonicalWebRecommendations({
        accessToken: "pre-ranks-token-1234567890",
        count: 10,
        requestSeed: "web-pre-ranks",
      }),
    );

    // Bounded serializable tuple form (Map does not survive the server seam).
    expect(Array.isArray(success.preRanks)).toBe(true);
    expect(success.preRanks).toEqual([
      [202, 7],
      [101, 3],
    ]);
    expect(JSON.parse(JSON.stringify(success.preRanks))).toEqual([
      [202, 7],
      [101, 3],
    ]);
    expect(success.preRanks.length).toBeLessThanOrEqual(100);
  });

  it("passes one bounded deadline budget through scoring and final hydration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));

    const initialDetails = new Map([
      [101, { id: 101, title: "Initial 101", genres: [] }],
    ]);
    const finalDetails = new Map([
      [303, { id: 303, title: "Final 303", genres: [] }],
    ]);
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: [101],
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map());
    mocks.ensureCompleteTmdbDetails
      .mockImplementationOnce(async () => {
        vi.advanceTimersByTime(1_250);
        return {
          details: initialDetails,
          requested: 1,
          completed: 1,
          failed: 0,
          deadlineExpired: false,
        };
      })
      .mockResolvedValueOnce({
        details: finalDetails,
        requested: 1,
        completed: 1,
        failed: 0,
        deadlineExpired: false,
      });
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (
        request: unknown,
        dependencies: {
          retrieveCandidates: () => Promise<Array<{ tmdbId: number }>>;
          scoreCandidates: (params: {
            request: unknown;
            context: unknown;
            mode: string;
            candidates: Array<{ tmdbId: number }>;
          }) => Promise<readonly unknown[]>;
        },
      ) => {
        const candidates = await dependencies.retrieveCandidates();
        const scored = await dependencies.scoreCandidates({
          request,
          context: {},
          mode: "personalized",
          candidates,
        });
        return {
          results:
            scored.length > 0
              ? [
                  {
                    tmdbId: 303,
                    score: 10,
                    evidence: {
                      seedAnchors: [],
                      providerFamilies: [],
                      providerOccurrences: 0,
                      retrievalScore: 1,
                    },
                    attribution: {
                      retrieval: 1,
                      preference: 0,
                      context: 0,
                      diversity: 0,
                      total: 1,
                    },
                  },
                ]
              : [],
          diagnostics: {},
          preRanksById: new Map<number, number>(),
        };
      },
    );

    const result = await generateCanonicalWebRecommendations({
      accessToken: "deadline-budget-token-1234567890",
      count: 1,
      requestSeed: "web-deadline-budget",
    });

    expect(mocks.loadCachedTmdbDetails).toHaveBeenNthCalledWith(1, [101]);
    expect(mocks.loadCachedTmdbDetails).toHaveBeenNthCalledWith(2, [303]);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(2);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenNthCalledWith(
      1,
      [101],
      expect.any(Map),
      { deadlineMs: expect.any(Number) },
    );
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenNthCalledWith(
      2,
      [303],
      expect.any(Map),
      { deadlineMs: expect.any(Number) },
    );

    const initialDeadlineMs = expectBoundedDeadline(
      mocks.ensureCompleteTmdbDetails.mock.calls[0],
    );
    const finalDeadlineMs = expectBoundedDeadline(
      mocks.ensureCompleteTmdbDetails.mock.calls[1],
    );
    expect(finalDeadlineMs).toBeLessThanOrEqual(initialDeadlineMs - 1_250);
    expect(successfulResult(result).items.map((item) => item.id)).toEqual([
      303,
    ]);
  });

  it("starts the shared metadata budget after retrieval builds the scoring window", async () => {
    vi.useFakeTimers();

    let releaseRetrieval!: () => void;
    let retrievalStarted!: () => void;
    const retrievalReady = new Promise<void>((resolve) => {
      retrievalStarted = resolve;
    });
    const retrievalRelease = new Promise<void>((resolve) => {
      releaseRetrieval = resolve;
    });

    mocks.generateServerCandidates.mockImplementationOnce(async () => {
      retrievalStarted();
      await retrievalRelease;
      return {
        candidateIds: [101],
        sourceMetadata: new Map(),
      };
    });

    const generation = generateCanonicalWebRecommendations({
      accessToken: "metadata-start-token-1234567890",
      count: 1,
      requestSeed: "web-metadata-start",
    });

    await retrievalReady;
    const retrievalStartedAt = Date.now();
    vi.setSystemTime(retrievalStartedAt + 5_000);
    releaseRetrieval();

    await generation;

    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [101],
      expect.any(Map),
      { deadlineMs: 20_000 },
    );
  });

  it("rejects unhealthy metadata before invoking scoring", async () => {
    mocks.isMetadataCompletionHealthy.mockReturnValueOnce(false);

    const result = await generateCanonicalWebRecommendations({
      accessToken: "unhealthy-metadata-token-1234567890",
      count: 10,
      requestSeed: "web-unhealthy-metadata",
    });

    expect(result).toEqual({
      error: {
        code: "METADATA_UNAVAILABLE",
        message:
          "Movie metadata is temporarily unavailable. Please retry suggestions.",
        retryable: true,
      },
    });
    expect(mocks.scoreRecommendationsWithOverlap).not.toHaveBeenCalled();
  });

  it("biases niche and mixed requests through the canonical TMDB genre profile", async () => {
    await generateCanonicalWebRecommendations({
      accessToken: "genre-anime-token-1234567890",
      count: 10,
      genreNames: ["Anime"],
      requestSeed: "web-genre-anime-profile",
    });

    expect(mocks.generateServerCandidates.mock.calls[0][2]).toEqual({
      topGenres: [{ id: 16, name: "Animation", weight: 1, count: 1 }],
    });

    mocks.generateServerCandidates.mockClear();

    await generateCanonicalWebRecommendations({
      accessToken: "genre-mixed-token-1234567890",
      count: 10,
      genreNames: ["Action", "Sports"],
      requestSeed: "web-genre-mixed-profile",
    });

    expect(mocks.generateServerCandidates.mock.calls[0][2]).toEqual({
      topGenres: [
        { id: 28, name: "Action", weight: 1, count: 1 },
        { id: 99, name: "Documentary", weight: 1, count: 1 },
      ],
    });
  });

  it("hydrates only the final ordered IDs after canonical generation", async () => {
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: [101, 202, 303],
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails.mockResolvedValue(
      new Map([
        [101, { title: "Cached 101", genres: [] }],
        [202, { title: "Cached 202", genres: [] }],
      ]),
    );
    const completedDetails = new Map([
      [101, { id: 101, title: "Completed 101", genres: [] }],
      [202, { id: 202, title: "Completed 202", genres: [] }],
      [303, { id: 303, title: "Completed 303", genres: [] }],
    ]);
    mocks.ensureCompleteTmdbDetails.mockResolvedValue({
      details: completedDetails,
      requested: 3,
      completed: 3,
      failed: 0,
      deadlineExpired: false,
    });
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (
        request: unknown,
        dependencies: {
          retrieveCandidates: () => Promise<Array<{ tmdbId: number }>>;
          scoreCandidates: (params: {
            request: unknown;
            context: unknown;
            mode: string;
            candidates: Array<{ tmdbId: number }>;
          }) => Promise<readonly { tmdbId: number }[]>;
        },
      ) => {
        const candidates = await dependencies.retrieveCandidates();
        const scored = await dependencies.scoreCandidates({
          request,
          context: {},
          mode: "personalized",
          candidates,
        });
        return {
          results: scored.filter(({ tmdbId }) => tmdbId !== 101),
          diagnostics: {},
          preRanksById: new Map<number, number>(),
        };
      },
    );

    const result = await generateCanonicalWebRecommendations({
      accessToken: "final-hydration-token-1234567890",
      count: 10,
      requestSeed: "web-final-hydration",
    });

    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledWith([101, 202, 303]);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [101, 202, 303],
      expect.any(Map),
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    expectBoundedDeadline(mocks.ensureCompleteTmdbDetails.mock.calls[0]);
    expect(mocks.scoreRecommendationsWithOverlap.mock.calls[0][1]).toBe(
      completedDetails,
    );
    expect(successfulResult(result).items.map((item) => item.id)).toEqual([
      202, 303,
    ]);
  });

  it("bounds retrieval and scoring to the ordered unique candidate window", async () => {
    const windowIds = Array.from({ length: 300 }, (_, index) => index + 1);
    const generatedIds = [
      ...Array.from({ length: 350 }, (_, index) => index + 1),
      2,
    ];
    const completedDetails = new Map(
      windowIds.map((tmdbId) => [
        tmdbId,
        { id: tmdbId, title: `Movie ${tmdbId}`, genres: [] },
      ]),
    );
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: generatedIds,
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails.mockResolvedValue(new Map());
    mocks.ensureCompleteTmdbDetails.mockResolvedValue({
      details: completedDetails,
      requested: 300,
      completed: 300,
      failed: 0,
      deadlineExpired: false,
    });

    await generateCanonicalWebRecommendations({
      accessToken: "ordered-window-token-1234567890",
      count: 100,
      requestSeed: "web-ordered-window",
    });

    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledWith(windowIds);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      windowIds,
      expect.any(Map),
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    const completionOptions = mocks.ensureCompleteTmdbDetails.mock
      .calls[0][2] as {
      deadlineMs: number;
    };
    expect(Number.isFinite(completionOptions.deadlineMs)).toBe(true);
    expect(completionOptions.deadlineMs).toBeGreaterThanOrEqual(0);
    expect(completionOptions.deadlineMs).toBeLessThanOrEqual(20_000);
    expect(
      mocks.scoreRecommendationsWithOverlap.mock.calls[0][0].candidates.map(
        ({ tmdbId }: { tmdbId: number }) => tmdbId,
      ),
    ).toEqual(windowIds);
    expect(
      mocks.scoreRecommendationsWithOverlap.mock.calls[0][0].candidates,
    ).toHaveLength(300);
  });

  it("filters canonical exclusions before filling the bounded window", async () => {
    const generatedIds = Array.from({ length: 101 }, (_, index) => index + 1);
    mocks.loadRecommendationContext.mockResolvedValue({
      watchedTmdbIds: new Set(
        Array.from({ length: 48 }, (_, index) => index + 3),
      ),
      blockedTmdbIds: new Set(
        Array.from({ length: 50 }, (_, index) => index + 51),
      ),
    });
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: generatedIds,
      sourceMetadata: new Map(),
    });

    await generateCanonicalWebRecommendations({
      accessToken: "exclusion-window-token-1234567890",
      count: 1,
      seedTmdbIds: [1],
      excludeTmdbIds: [2],
      requestSeed: "web-exclusion-window",
    });

    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledWith([101]);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [101],
      expect.any(Map),
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    expectBoundedDeadline(mocks.ensureCompleteTmdbDetails.mock.calls[0]);
    expect(
      mocks.scoreRecommendationsWithOverlap.mock.calls[0][0].candidates.map(
        ({ tmdbId }: { tmdbId: number }) => tmdbId,
      ),
    ).toEqual([101]);
  });

  it("applies strict genre filtering inside the bounded window", async () => {
    const windowIds = Array.from({ length: 300 }, (_, index) => index + 1);
    const generatedIds = Array.from({ length: 350 }, (_, index) => index + 1);
    const completedDetails = new Map(
      windowIds.map((tmdbId) => [
        tmdbId,
        {
          id: tmdbId,
          title: `Movie ${tmdbId}`,
          genres: [
            { name: tmdbId === 7 || tmdbId === 11 ? "Action" : "Drama" },
          ],
        },
      ]),
    );
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: generatedIds,
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails.mockResolvedValue(new Map());
    mocks.ensureCompleteTmdbDetails.mockResolvedValue({
      details: completedDetails,
      requested: 300,
      completed: 300,
      failed: 0,
      deadlineExpired: false,
    });

    const result = await generateCanonicalWebRecommendations({
      accessToken: "strict-window-token-1234567890",
      count: 100,
      genreNames: ["Action"],
      requestSeed: "web-strict-window",
    });

    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      windowIds,
      expect.any(Map),
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    expectBoundedDeadline(mocks.ensureCompleteTmdbDetails.mock.calls[0]);
    const scoredIds =
      mocks.scoreRecommendationsWithOverlap.mock.calls[0][0].candidates.map(
        ({ tmdbId }: { tmdbId: number }) => tmdbId,
      );
    expect(scoredIds).toEqual([7, 11]);
    expect(scoredIds).not.toContain(301);
    expect(scoredIds).not.toContain(350);
    expect(successfulResult(result).items.map((item) => item.id)).toEqual([
      7, 11,
    ]);
  });

  it("rejects a missing canonical result before final hydration", async () => {
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (
        _request: unknown,
        dependencies: {
          retrieveCandidates: () => Promise<Array<{ tmdbId: number }>>;
        },
      ) => {
        await dependencies.retrieveCandidates();
        return undefined;
      },
    );

    await expect(
      generateCanonicalWebRecommendations({
        accessToken: "missing-result-token-1234567890",
        count: 10,
        requestSeed: "web-missing-canonical-result",
      }),
    ).rejects.toThrow("Canonical recommendation result is invalid");

    expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
  });

  it("reuses cached metadata for cold-start scoring", async () => {
    const cachedMovie: TMDBMovie = {
      id: 7001,
      title: "Cached cold-start movie",
      vote_average: 8.4,
      vote_count: 1200,
      genres: [{ id: 28, name: "Action" }],
      credits: { cast: [], crew: [] },
      keywords: { keywords: [] },
    };
    const fallbackFetch = vi
      .fn()
      .mockRejectedValue(new Error("unexpected cold-start metadata fetch"));
    vi.stubGlobal("fetch", fallbackFetch);

    try {
      const results = await suggestByOverlap({
        userId: "cold-start-cache-user",
        films: [],
        mappings: new Map(),
        candidates: [7001],
        tmdbDetailsCache: new Map([[7001, cachedMovie]]),
        feedbackMap: new Map(),
        desiredResults: 1,
      });

      expect(results.map((result) => result.tmdbId)).toEqual([7001]);
      expect(fallbackFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
