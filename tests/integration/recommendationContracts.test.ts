import { describe, expect, it } from "vitest";

import {
  NEUTRAL_CONTEXT,
  deriveRecommendationMode,
  normalizeRecommendationRequest,
  validateRecommendationRequest,
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
});
