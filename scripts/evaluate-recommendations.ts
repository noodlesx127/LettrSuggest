import {
  evaluateRecommendationCorpus,
  renderRecommendationEvaluationJson,
  renderRecommendationEvaluationMarkdown,
  type RecommendationEvaluationReport,
} from "../tests/fixtures/recommendations/evaluationCorpus";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type RecommendationEvaluationCliReport = Readonly<{
  passed: boolean;
}>;

export type RecommendationEvaluationRunner = () => Promise<RecommendationEvaluationCliReport>;
export type RecommendationEvaluationRenderer = (
  report: RecommendationEvaluationCliReport,
) => string | Promise<string>;
export type RecommendationEvaluationWriter = (chunk: string) => void;

async function runDefaultRecommendationEvaluation(): Promise<RecommendationEvaluationReport> {
  const report = await evaluateRecommendationCorpus();
  if (
    process.env.NODE_ENV === "test" &&
    process.env.LETTRSUGGEST_EVALUATION_FORCE_FAILURE === "1"
  ) {
    return {
      ...report,
      passed: false,
      failures: [...report.failures, "forced evaluation threshold failure"],
    };
  }
  return report;
}

async function renderDefaultRecommendationEvaluation(
  report: RecommendationEvaluationCliReport,
): Promise<string> {
  const evaluationReport = report as RecommendationEvaluationReport;

  return [
    "RECOMMENDATION_EVALUATION_JSON",
    renderRecommendationEvaluationJson(evaluationReport),
    "RECOMMENDATION_EVALUATION_MARKDOWN",
    renderRecommendationEvaluationMarkdown(evaluationReport),
    "",
  ].join("\n");
}

const SAFE_EVALUATION_ERROR_CODE = "EVALUATION_RUNNER_ERROR" as const;

/**
 * Keep unexpected failures opaque. Error names and messages can contain
 * secrets, filesystem paths, provider responses, or other private input.
 */
function describeEvaluationError(_error: unknown): typeof SAFE_EVALUATION_ERROR_CODE {
  return SAFE_EVALUATION_ERROR_CODE;
}

/**
 * Run the standalone evaluator without owning process termination. Tests can
 * inject a runner, renderer, and writer while the executable entry point maps
 * the returned status to `process.exitCode`.
 */
export async function runRecommendationEvaluationCli(
  runner: RecommendationEvaluationRunner = runDefaultRecommendationEvaluation,
  renderer: RecommendationEvaluationRenderer = renderDefaultRecommendationEvaluation,
  writer: RecommendationEvaluationWriter = (chunk) => {
    process.stdout.write(chunk);
  },
  errorWriter: RecommendationEvaluationWriter = (chunk) => {
    process.stderr.write(chunk);
  },
): Promise<number> {
  try {
    const report = await runner();
    writer(await renderer(report));
    return report.passed ? 0 : 1;
  } catch (error: unknown) {
    errorWriter(
      `[RecommendationEvaluation] runner failed ${describeEvaluationError(error)}\n`,
    );
    return 1;
  }
}

// Keep the earlier focused-test name as a compatibility alias while exposing
// the explicit CLI seam used by new callers.
export const runRecommendationEvaluation = runRecommendationEvaluationCli;

function filePathForEntry(value: string): string | null {
  try {
    return resolve(value.startsWith("file:") ? fileURLToPath(value) : value);
  } catch {
    return null;
  }
}

/**
 * Compare filesystem paths rather than raw argv strings. This handles Windows
 * drive-letter casing and both path and file-URL forms of the Node ESM entry.
 */
function isDirectEntryModule(): boolean {
  const entryArgument = process.argv[1];
  if (!entryArgument) return false;

  const currentPath = filePathForEntry(fileURLToPath(import.meta.url));
  const entryPath = filePathForEntry(entryArgument);
  if (!currentPath || !entryPath) return false;

  return process.platform === "win32"
    ? currentPath.toLowerCase() === entryPath.toLowerCase()
    : currentPath === entryPath;
}

async function main(): Promise<void> {
  process.exitCode = await runRecommendationEvaluationCli();
}

if (isDirectEntryModule()) {
  void main().catch((error: unknown) => {
    console.error(
      "[RecommendationEvaluation] runner failed",
      describeEvaluationError(error),
    );
    process.exitCode = 1;
  });
}
