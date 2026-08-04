import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runRecommendationEvaluation } from "../../scripts/evaluate-recommendations";
import {
  DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS,
  evaluateVectorCapability,
} from "@/lib/recommendationCandidates";
import type { RecommendationRequestInput } from "@/lib/recommendationTypes";
import {
  evaluateRecommendationCorpus,
  RECOMMENDATION_EVALUATION_CORPUS_VERSION,
  renderRecommendationEvaluationJson,
  renderRecommendationEvaluationMarkdown,
  recommendationEvaluationCorpus,
  type RecommendationEvaluationCase,
} from "../fixtures/recommendations/evaluationCorpus";

describe("offline recommendation quality evaluation", () => {
  it("passes the versioned corpus without contract or parity failures", async () => {
    const report = await evaluateRecommendationCorpus();

    expect(RECOMMENDATION_EVALUATION_CORPUS_VERSION).toBe("2c.1");
    expect(report.cases).toHaveLength(8);
    expect(report.failures).toEqual([]);
  });

  it("routes raw corpus inputs through production evidence and scoring seams", async () => {
    const report = await evaluateRecommendationCorpus();
    const seamUsage = (
      report as typeof report & {
        productionSeams?: {
          evidenceMerge?: number;
          personalizationBuilder?: number;
          scoringStage?: number;
          productionReranker?: number;
          strictGenreFiltering?: number;
          vectorEvidenceRowsIgnored?: number;
        };
      }
    ).productionSeams;

    expect(Object.hasOwn(recommendationEvaluationCorpus[0].candidates[0], "score")).toBe(
      false,
    );
    // 4 independent runs (web, web repeat, v1, v1 repeat) x 7 generated cases.
    // The degraded case stops at the shared input-health preflight, so it runs
    // no generation and compares bounded rejection descriptors instead.
    expect(seamUsage).toEqual({
      evidenceMerge: 28,
      personalizationBuilder: 28,
      scoringStage: 28,
      productionReranker: 28,
      strictGenreFiltering: 4,
      vectorEvidenceRowsIgnored: 1,
    });
  });

  it("stops degraded generation and compares bounded rejection descriptors", async () => {
    const report = await evaluateRecommendationCorpus();
    const degradedCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "degraded-inputs",
    );

    expect(report.failures).toEqual([]);
    expect(degradedCase?.passed).toBe(true);
    expect(degradedCase?.failures).toEqual([]);
    // No generated IDs: the bounded rejection outcome replaces generation.
    expect(degradedCase?.metrics.resultCount).toBe(0);
    expect(degradedCase?.metrics.countFulfillment).toBe(0);
    expect(degradedCase?.metrics.mode).toBe("degraded");
    expect(degradedCase?.metrics.failedSourceCount).toBe(1);
    expect(degradedCase?.metrics.webV1Parity).toBe(true);
    expect(degradedCase?.metrics.deterministicRepeats).toBe(true);
  });

  it("uses the production retrieval seam instead of returning frozen candidate IDs", () => {
    const source = readFileSync(
      resolve(process.cwd(), "tests/fixtures/recommendations/evaluationCorpus.ts"),
      "utf8",
    );

    expect(source).toContain("retrieveServerCandidates");
    expect(source).toContain("@/lib/recommendationRetrieval");
    expect(source).not.toContain("@/lib/serverSuggestionsEngine");
    expect(source).not.toMatch(
      /candidateIds:\s*evaluationCase\.candidates\.map\(\(candidate\) => candidate\.tmdbId\)/,
    );
    expect(source).not.toMatch(
      /sourceMetadata:\s*runtime\.sourceMetadata\s*[,}]/,
    );
  });

  it("keeps a fully capable vector result out while productionEnabled is false", async () => {
    const report = await evaluateRecommendationCorpus();

    const vectorCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "provider-duplication",
    );

    expect(vectorCase?.metrics.vectorResults).toBe(0);
    expect(report.productionSeams.vectorEvidenceRowsIgnored).toBe(1);
  });

  it("fails the evaluation if a mutation activates vector retrieval", async () => {
    const report = await evaluateRecommendationCorpus(recommendationEvaluationCorpus, {
      vectorProductionEnabled: true,
    });

    expect(report.passed).toBe(false);
    expect(report.failures).toContain(
      "provider-duplication: vector retrieval activated",
    );
  });

  it("documents the production-merge metric formulas and vector gate", async () => {
    const report = await evaluateRecommendationCorpus();
    const providerCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "provider-duplication",
    );
    const largeCountCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "large-requested-count",
    );

    expect(providerCase?.metrics.providerDuplicationShare).toBeCloseTo(0.375);
    expect(providerCase?.metrics.availableGenreCount).toBe(9);
    expect(providerCase?.metrics.uniqueGenreCount).toBe(5);
    expect(largeCountCase?.metrics.genreCoverage).toBe(1);
    expect(
      report.cases.every(
        (evaluationCase) =>
          evaluationCase.metrics.rankChurn >= 0 &&
          evaluationCase.metrics.rankChurn <= 1 &&
          evaluationCase.metrics.webDeterministicRepeats &&
          evaluationCase.metrics.v1DeterministicRepeats,
      ),
    ).toBe(true);
    expect(report.productionSeams.vectorEvidenceRowsIgnored).toBe(1);

    const vectorResults = [
      { tmdbId: 1603, similarity: 0.91 },
      { tmdbId: 1602, similarity: 0.82 },
    ];
    expect(
      evaluateVectorCapability({
        modelVersion: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.modelVersion,
        dimensions: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.dimensions,
        backfill: {
          status: "complete",
          modelVersion: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.modelVersion,
          dimensions: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.dimensions,
          expectedCount: vectorResults.length,
          completedCount: vectorResults.length,
          failureCount: 0,
        },
        cachedResults: vectorResults,
        uncachedResults: [...vectorResults],
      }),
    ).toMatchObject({
      capable: true,
      eligible: true,
      productionEnabled: false,
      activation: "disabled",
      failedChecks: [],
    });

    const negativeCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "strong-negatives",
    );
    expect(negativeCase?.metrics.negativeFeedbackResults).toBe(0);
  });

  it("fails parity when a surface-specific preparation mutation diverges", async () => {
    const mutatedCorpus = recommendationEvaluationCorpus.map((evaluationCase) =>
      evaluationCase.id === "strict-genres"
        ? {
            ...evaluationCase,
            request: {
              ...evaluationCase.request,
              genres: ["Anime"],
            },
            genreIds: [16],
          }
        : evaluationCase,
    );

    const report = await evaluateRecommendationCorpus(mutatedCorpus);

    expect(report.passed).toBe(false);
    expect(report.failures).toContain("strict-genres: web/v1 parity failed");
  });

  it("fails when a strong-negative result is promoted into the output", async () => {
    const mutatedCorpus = recommendationEvaluationCorpus.map((evaluationCase) =>
      evaluationCase.id === "strong-negatives"
        ? {
            ...evaluationCase,
            request: {
              ...evaluationCase.request,
              count: evaluationCase.candidates.length,
            },
            context: {
              ...evaluationCase.context,
              // Disable only the production negative-feedback input. Keep the
              // frozen negative IDs below so the evaluator can catch a
              // promoted result without forging metrics.
              feedback: [],
              inputHealth: {
                ...evaluationCase.context.inputHealth,
                feedback: { health: "empty" as const, rowCount: 0 },
              },
            },
          }
        : evaluationCase,
    );

    const report = await evaluateRecommendationCorpus(mutatedCorpus);
    const negativeCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === "strong-negatives",
    );

    expect(report.passed).toBe(false);
    expect(negativeCase?.metrics.negativeFeedbackResults).toBeGreaterThan(0);
    expect(negativeCase?.failures).toEqual([
      "strong-negative feedback result detected",
    ]);
    expect(report.failures).toContain(
      "strong-negatives: strong-negative feedback result detected",
    );
  });

  it("fails when a frozen candidate mutation removes genre diversity", async () => {
    const mutatedCorpus = recommendationEvaluationCorpus.map(
      (evaluationCase, caseIndex) =>
        caseIndex === 0
          ? {
              ...evaluationCase,
              request: {
                ...evaluationCase.request,
                excludeTmdbIds: [1103, 1105, 1106],
              },
              candidates: evaluationCase.candidates.map((candidate) =>
                [1101, 1102, 1104].includes(candidate.tmdbId)
                  ? {
                      ...candidate,
                      movie: {
                        ...candidate.movie,
                        genres: [{ id: 18, name: "Drama" }],
                      },
                    }
                  : candidate,
              ),
            }
          : evaluationCase,
    );

    const report = await evaluateRecommendationCorpus(mutatedCorpus);

    expect(report.passed).toBe(false);
    expect(report.failures).toContain(
      "sparse-history: all-genre coverage below threshold",
    );
  });

  it("fails boundedly for an injected threshold failure", async () => {
    const failingCorpus = recommendationEvaluationCorpus.map((evaluationCase, index) =>
      index === 0
        ? {
            ...evaluationCase,
            thresholds: {
              ...evaluationCase.thresholds,
              minResultCount: evaluationCase.request.count + 1,
            },
          }
        : evaluationCase,
    );
    const report = await evaluateRecommendationCorpus(failingCorpus);
    const json = renderRecommendationEvaluationJson(report);
    const markdown = renderRecommendationEvaluationMarkdown(report);

    expect(report.passed).toBe(false);
    expect(report.failures).toContain(
      "sparse-history: count fulfillment below minimum",
    );
    expect(report.failures.length).toBeLessThanOrEqual(64);
    expect(json.length).toBeLessThan(20_000);
    expect(markdown.length).toBeLessThan(8_000);
    for (const output of [json, markdown]) {
      expect(output).not.toContain("historyTmdbIds");
      expect(output).not.toContain("rawProviderRows");
      expect(output).not.toContain("letterboxd://evaluation/");
      expect(output).not.toContain("evaluation-sparse-seed");
      expect(output).not.toContain('"candidates"');
    }
  });

  it("returns a failing CLI exit code through its testable run seam", async () => {
    let output = "";
    const exitCode = await runRecommendationEvaluation(
      async () => ({ passed: false }),
      (report) => `status=${report.passed ? "pass" : "fail"}`,
      (chunk) => {
        output += chunk;
      },
    );

    expect(exitCode).toBe(1);
    expect(output).toBe("status=fail");
  });

  it("exits nonzero from the standalone entry for a controlled failed report", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/evaluate-recommendations-node20.mjs"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          LETTRSUGGEST_EVALUATION_FORCE_FAILURE: "1",
        },
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"passed": false');
    expect(result.stdout.length).toBeLessThan(20_000);
    expect(result.stdout).not.toContain("rawProviderRows");
    expect(result.stdout).not.toContain("historyTmdbIds");
  });

  it("does not expose unexpected evaluator error messages", async () => {
    const secretMessage =
      "secret-token C:\\private\\recommendation-export.json should-not-leak";
    let stdout = "";
    let stderr = "";

    const exitCode = await runRecommendationEvaluation(
      async () => {
        throw new Error(secretMessage);
      },
      () => "unused",
      (chunk) => {
        stdout += chunk;
      },
      (chunk) => {
        stderr += chunk;
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).not.toContain(secretMessage);
    expect(stderr).toMatch(
      /^\[RecommendationEvaluation\] runner failed [A-Z0-9_]+\n$/,
    );
    expect(stderr.length).toBeLessThan(256);
  });

  it("emits a fixed EVALUATION_CASE_ERROR without malicious error names or messages", async () => {
    const maliciousName = "MaliciousExfiltrationError";
    const maliciousMessage =
      "secret-token C:\\private\\recommendation-export.json should-not-leak";
    const poisonedCase: RecommendationEvaluationCase = {
      ...recommendationEvaluationCorpus[0],
      get request(): RecommendationRequestInput {
        const error = new Error(maliciousMessage);
        error.name = maliciousName;
        throw error;
      },
    };

    const report = await evaluateRecommendationCorpus(
      recommendationEvaluationCorpus.map((evaluationCase) =>
        evaluationCase.id === poisonedCase.id
          ? poisonedCase
          : evaluationCase,
      ),
    );
    const failedCase = report.cases.find(
      (evaluationCase) => evaluationCase.id === poisonedCase.id,
    );

    expect(report.passed).toBe(false);
    expect(failedCase?.passed).toBe(false);
    expect(failedCase?.failures).toEqual(["EVALUATION_CASE_ERROR"]);

    const json = renderRecommendationEvaluationJson(report);
    const markdown = renderRecommendationEvaluationMarkdown(report);
    for (const output of [json, markdown]) {
      expect(output).toContain("EVALUATION_CASE_ERROR");
      expect(output).not.toContain(maliciousName);
      expect(output).not.toContain(maliciousMessage);
      expect(output).not.toContain("secret-token");
      expect(output).not.toContain("Exfiltration");
    }
  });
});
