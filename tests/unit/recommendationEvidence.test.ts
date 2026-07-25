import { describe, expect, it } from "vitest";

import {
  applySourceIntentQuotas,
  getProviderEvidenceBonus,
  getProviderConsensusLevel,
  mergeCandidateEvidence,
} from "@/lib/recommendationCandidates";

const providerFamily = (source: string): string => {
  if (source === "watchmode" || source === "watchmode-similar") {
    return "watchmode";
  }
  return source;
};

describe("recommendation evidence semantics", () => {
  const evidence = [
    {
      tmdbId: 101,
      title: "Repeated",
      source: "tmdb",
      confidence: 0.91,
      reason: "TMDB seed one",
    },
    {
      tmdbId: 101,
      title: "Repeated",
      source: "tmdb",
      confidence: 0.82,
      reason: "TMDB seed two",
    },
    {
      tmdbId: 101,
      title: "Repeated",
      source: "tmdb",
      confidence: 0.73,
      reason: "TMDB seed three",
    },
    {
      tmdbId: 202,
      title: "Independent",
      source: "tmdb",
      confidence: 0.64,
      reason: "TMDB evidence",
    },
    {
      tmdbId: 202,
      title: "Independent",
      source: "tastedive",
      confidence: 0.88,
      reason: "TasteDive evidence",
    },
  ] as const;

  it("counts distinct provider families as consensus and tracks repetition separately", () => {
    const merged = mergeCandidateEvidence(evidence, providerFamily);
    const repeated = merged.find((candidate) => candidate.tmdbId === 101);
    const independent = merged.find((candidate) => candidate.tmdbId === 202);

    expect(repeated).toMatchObject({
      providerFamilies: ["tmdb"],
      familyCount: 1,
      providerOccurrences: 3,
      repetitionsByFamily: { tmdb: 3 },
    });
    expect(independent).toMatchObject({
      providerFamilies: ["tastedive", "tmdb"],
      familyCount: 2,
      providerOccurrences: 2,
      repetitionsByFamily: { tastedive: 1, tmdb: 1 },
    });
    expect(getProviderConsensusLevel(repeated!.familyCount)).toBe("low");
    expect(getProviderConsensusLevel(independent!.familyCount)).toBe("medium");
  });

  it("normalizes provider variants and caps repetition below true consensus", () => {
    const [watchmode] = mergeCandidateEvidence(
      [
        { tmdbId: 404, source: "watchmode", confidence: 0.5 },
        { tmdbId: 404, source: "watchmode-similar", confidence: 0.7 },
      ],
      providerFamily,
    );

    expect(watchmode).toMatchObject({
      providerFamilies: ["watchmode"],
      familyCount: 1,
      providerOccurrences: 2,
    });
    expect(getProviderEvidenceBonus(1, 4)).toBe(
      getProviderEvidenceBonus(1, 30),
    );
    expect(getProviderEvidenceBonus(1, 30)).toBeLessThan(
      getProviderEvidenceBonus(2, 2),
    );
  });

  it("preserves raw source confidence and reason attribution deterministically", () => {
    const [repeated] = mergeCandidateEvidence(
      evidence.filter((candidate) => candidate.tmdbId === 101).reverse(),
      providerFamily,
    );

    expect(repeated.sources).toEqual([
      {
        source: "tmdb",
        confidence: 0.91,
        reason: "TMDB seed one",
      },
      {
        source: "tmdb",
        confidence: 0.82,
        reason: "TMDB seed two",
      },
      {
        source: "tmdb",
        confidence: 0.73,
        reason: "TMDB seed three",
      },
    ]);
  });

  it("applies provider-family quotas before the global result window", () => {
    const [repeated] = mergeCandidateEvidence(
      evidence.filter((candidate) => candidate.tmdbId === 101),
      providerFamily,
    );
    const retained = applySourceIntentQuotas(
      [
        {
          ...repeated,
          sources: repeated.providerFamilies,
          score: 100,
        },
        {
          tmdbId: 202,
          providerFamilies: ["tmdb"],
          sources: ["tmdb"],
          score: 90,
        },
        {
          tmdbId: 303,
          providerFamilies: ["tastedive"],
          sources: ["tastedive"],
          score: 80,
        },
      ],
      { limit: 2, sourceQuotas: { tmdb: 1, tastedive: 2 } },
    );

    expect(retained.map((candidate) => candidate.tmdbId)).toEqual([101, 303]);
  });
});
