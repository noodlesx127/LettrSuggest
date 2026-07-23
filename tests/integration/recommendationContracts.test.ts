import { describe, expect, it } from "vitest";

import {
  NEUTRAL_CONTEXT,
  deriveRecommendationMode,
  normalizeRecommendationRequest,
  validateRecommendationRequest,
  validateRecommendationDiagnostics,
  validateRecommendationResult,
} from "@/lib/recommendationTypes";
import { canonicalFixture } from "../fixtures/recommendations/canonicalFixture";

describe("canonical recommendation contracts", () => {
  it("keeps the frozen fixture deterministic and safe at the result boundary", () => {
    const fixture = canonicalFixture;
    const request = normalizeRecommendationRequest(fixture.request);
    const result = fixture.result;
    const seedIds = new Set(request.seeds.map((seed) => seed.tmdbId));

    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.request)).toBe(true);
    expect(Object.isFrozen(fixture.result)).toBe(true);
    expect(request.context).toEqual(NEUTRAL_CONTEXT);
    expect(validateRecommendationRequest(request)).toBe(true);
    expect(result.results.map((candidate) => candidate.tmdbId)).toEqual([
      303, 404, 505,
    ]);
    expect(
      result.results.some((candidate) => seedIds.has(candidate.tmdbId)),
    ).toBe(false);
    expect(result.diagnostics.inputHealth).toMatchObject({
      films: { health: "ok", rowCount: 12 },
      mappings: { health: "ok", rowCount: 12 },
      exploration: { health: "empty", rowCount: 0 },
    });
    expect(result.results[0].attribution).toEqual({
      retrieval: 0.91,
      preference: 0.7,
      context: 0,
      diversity: 0.1,
      total: 1.71,
    });
    expect(validateRecommendationResult(result, request)).toBe(true);

    const diagnosticKeys = Object.keys(result.diagnostics);
    expect(
      diagnosticKeys.some((key) =>
        /film|watch|rating|private|secret|token|api[_-]?key|raw/i.test(key),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /private|secret|api[_-]?key|jwt|password/i,
    );
  });

  it("does not turn failed required input into personalized mode", () => {
    const inputHealth = {
      ...canonicalFixture.result.diagnostics.inputHealth,
      mappings: { health: "failed" as const, rowCount: 0 },
    };

    expect(
      deriveRecommendationMode({
        inputHealth,
        hasPersonalizedEvidence: true,
      }),
    ).toBe("degraded");
    expect(
      validateRecommendationResult(
        {
          ...canonicalFixture.result,
          diagnostics: {
            ...canonicalFixture.result.diagnostics,
            inputHealth,
            mode: "personalized",
          },
        },
        normalizeRecommendationRequest(canonicalFixture.request),
      ),
    ).toBe(false);
  });

  it("rejects unknown diagnostic shapes and invalid hash fields", () => {
    const diagnostics = canonicalFixture.result.diagnostics;

    expect(
      validateRecommendationDiagnostics({
        ...diagnostics,
        trace: {
          payload: { values: new Array(10_001).fill(101) },
        },
      }),
    ).toBe(false);
    expect(
      validateRecommendationDiagnostics({
        ...diagnostics,
        metadata: { credential: "sk_live_example_credential" },
      }),
    ).toBe(false);
    expect(
      validateRecommendationDiagnostics({
        ...diagnostics,
        requestSeedHash: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      }),
    ).toBe(false);
    expect(validateRecommendationDiagnostics(diagnostics)).toBe(true);
  });

  it("rejects a seed-containing result without a request-aware bypass", () => {
    const request = normalizeRecommendationRequest(canonicalFixture.request);
    const seedResult = {
      ...canonicalFixture.result,
      results: [
        ...canonicalFixture.result.results.slice(0, 2),
        { ...canonicalFixture.result.results[2], tmdbId: 101 },
      ],
    };
    const legacyBoundary = validateRecommendationResult as unknown as (
      value: unknown,
    ) => boolean;

    expect(legacyBoundary(seedResult)).toBe(false);
    expect(validateRecommendationResult(seedResult, request)).toBe(false);
  });

  it("rejects the legacy raw requestSeed diagnostic field", () => {
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        requestSeed: "sk_live_example_credential",
      }),
    ).toBe(false);
  });

  it("rejects a result containing an explicit exclusion", () => {
    const request = normalizeRecommendationRequest(canonicalFixture.request);
    const excludedResult = {
      ...canonicalFixture.result,
      results: [
        ...canonicalFixture.result.results.slice(0, 2),
        { ...canonicalFixture.result.results[2], tmdbId: 909 },
      ],
    };

    expect(validateRecommendationResult(excludedResult, request)).toBe(false);
  });

  it("rejects sparse request, result, and evidence arrays", () => {
    const request = normalizeRecommendationRequest(canonicalFixture.request);
    const sparseSeeds = new Array(2);
    sparseSeeds[0] = request.seeds[0];
    const sparseRequest = { ...request, seeds: sparseSeeds };

    expect(validateRecommendationRequest(sparseRequest)).toBe(false);
    expect(() => normalizeRecommendationRequest(sparseRequest as never)).toThrow(
      "Invalid recommendation request",
    );

    const sparseResults = new Array(3);
    sparseResults[0] = canonicalFixture.result.results[0];
    sparseResults[1] = canonicalFixture.result.results[1];
    expect(
      validateRecommendationResult(
        { ...canonicalFixture.result, results: sparseResults },
        request,
      ),
    ).toBe(false);

    const sparseSeedAnchors = new Array(2);
    sparseSeedAnchors[0] = 101;
    const sparseProviderFamilies = new Array(2);
    sparseProviderFamilies[0] = "tmdb";
    const candidate = canonicalFixture.result.results[0];
    expect(
      validateRecommendationResult(
        {
          ...canonicalFixture.result,
          results: [
            {
              ...candidate,
              evidence: {
                ...candidate.evidence,
                seedAnchors: sparseSeedAnchors,
                providerFamilies: sparseProviderFamilies,
              },
            },
            ...canonicalFixture.result.results.slice(1),
          ],
        },
        request,
      ),
    ).toBe(false);
  });

  it("requires failedSources to exactly match failed source health", () => {
    const failedMappings = {
      ...canonicalFixture.result.diagnostics.inputHealth,
      mappings: { health: "failed" as const, rowCount: 0 },
    };

    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        inputHealth: failedMappings,
        failedSources: [],
      }),
    ).toBe(false);
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        failedSources: ["feedback"],
      }),
    ).toBe(false);
  });

  it("requires degraded mode for required failures without choosing evidence mode", () => {
    const failedMappings = {
      ...canonicalFixture.result.diagnostics.inputHealth,
      mappings: { health: "failed" as const, rowCount: 0 },
    };

    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        inputHealth: failedMappings,
        failedSources: ["mappings"],
        mode: "cold_start",
      }),
    ).toBe(false);
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        inputHealth: failedMappings,
        failedSources: ["mappings"],
        mode: "personalized",
      }),
    ).toBe(false);
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        inputHealth: failedMappings,
        failedSources: ["mappings"],
        mode: "degraded",
      }),
    ).toBe(true);
  });

  it("rejects degraded mode without a required source failure", () => {
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        mode: "degraded",
      }),
    ).toBe(false);

    const optionalFailure = {
      ...canonicalFixture.result.diagnostics.inputHealth,
      feedback: { health: "failed" as const, rowCount: 0 },
    };
    expect(
      validateRecommendationDiagnostics({
        ...canonicalFixture.result.diagnostics,
        inputHealth: optionalFailure,
        failedSources: ["feedback"],
        mode: "personalized",
      }),
    ).toBe(true);
  });

  it("rejects whitespace-only user IDs", () => {
    const request = normalizeRecommendationRequest(canonicalFixture.request);
    const whitespaceRequest = { ...request, userId: " \t\n" };

    expect(validateRecommendationRequest(whitespaceRequest)).toBe(false);
    expect(() =>
      normalizeRecommendationRequest({
        ...canonicalFixture.request,
        userId: " \t\n",
      }),
    ).toThrow("Invalid recommendation request");
  });
});
