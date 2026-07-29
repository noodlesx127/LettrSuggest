import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTasteProfileServer: vi.fn(),
  createDeterministicRng: vi.fn(),
  ensureCompleteTmdbDetails: vi.fn(),
  generateServerCandidates: vi.fn(),
  getUser: vi.fn(),
  getUserContextDiagnostics: vi.fn(),
  loadCachedTmdbDetails: vi.fn(),
  loadRecommendationContext: vi.fn(),
  loadUserContext: vi.fn(),
  runCanonicalServerRecommendations: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/recommendationCandidates", () => ({
  createDeterministicRng: mocks.createDeterministicRng,
}));

vi.mock("@/lib/recommendationContext", () => ({
  loadRecommendationContext: mocks.loadRecommendationContext,
}));

vi.mock("@/lib/enrich", () => ({
  scoreRecommendationsWithOverlap: vi.fn(),
}));

vi.mock("@/lib/serverSuggestionsEngine", () => ({
  buildTasteProfileServer: mocks.buildTasteProfileServer,
  ensureCompleteTmdbDetails: mocks.ensureCompleteTmdbDetails,
  generateServerCandidates: mocks.generateServerCandidates,
  getUserContextDiagnostics: mocks.getUserContextDiagnostics,
  loadCachedTmdbDetails: mocks.loadCachedTmdbDetails,
  loadUserContext: mocks.loadUserContext,
  runCanonicalServerRecommendations: mocks.runCanonicalServerRecommendations,
}));

import { generateCanonicalWebRecommendations } from "@/app/actions/recommendations";

describe("canonical web standard-genre detail completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "genre-user" } },
      error: null,
    });
    mocks.loadUserContext.mockResolvedValue({});
    mocks.getUserContextDiagnostics.mockReturnValue({
      mode: "personalized",
      inputHealth: { blocked: { health: "ok" } },
    });
    mocks.loadRecommendationContext.mockResolvedValue({});
    mocks.buildTasteProfileServer.mockResolvedValue({ topGenres: [] });
    mocks.generateServerCandidates.mockResolvedValue({
      candidateIds: [101, 202],
      sourceMetadata: new Map(),
    });
    mocks.loadCachedTmdbDetails.mockResolvedValue(new Map());
    mocks.ensureCompleteTmdbDetails.mockImplementation(
      async (_candidateIds: number[], cachedDetails: Map<number, unknown>) => {
        const completedDetails = new Map(cachedDetails);
        completedDetails.set(101, { genres: [{ name: "Action" }] });
        completedDetails.set(202, { genres: [{ name: "Drama" }] });
        return completedDetails;
      },
    );
    mocks.runCanonicalServerRecommendations.mockImplementation(
      async (_request: unknown, dependencies: { retrieveCandidates: () => Promise<Array<{ tmdbId: number }>> }) => {
        const candidates = await dependencies.retrieveCandidates();
        return {
          results: candidates.map(({ tmdbId }, index) => ({
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
          })),
          diagnostics: {},
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

    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(2);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [101, 202],
      expect.any(Map),
    );
    const cachedDetails = mocks.ensureCompleteTmdbDetails.mock.calls[0][1] as Map<
      number,
      unknown
    >;
    expect(cachedDetails.size).toBe(0);
    expect(result.items.map((item) => item.id)).toEqual([101]);
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
    mocks.runCanonicalServerRecommendations.mockResolvedValue({
      results: [
        {
          tmdbId: 202,
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
        {
          tmdbId: 303,
          score: 9,
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
      ],
      diagnostics: {},
    });

    const result = await generateCanonicalWebRecommendations({
      accessToken: "final-hydration-token-1234567890",
      count: 10,
      requestSeed: "web-final-hydration",
    });

    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
      [202, 303],
      expect.any(Map),
    );
    expect(result.items.map((item) => item.id)).toEqual([202, 303]);
  });
});
