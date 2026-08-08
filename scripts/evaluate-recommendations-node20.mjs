import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(repositoryRoot, "src");
const evaluatorPath = resolve(
  repositoryRoot,
  "scripts/evaluate-recommendations.ts",
);

let viteServer = null;
let exitCode = 1;

try {
  viteServer = await createServer({
    appType: "custom",
    logLevel: "error",
    root: repositoryRoot,
    resolve: {
      alias: {
        "@": sourceRoot,
        // Mirror the Vitest alias: the shared server engine now reaches the
        // server-only enrollment resolver through the canonical generation
        // chain; the corpus runner exercises it outside the bundler guard.
        "server-only": resolve(repositoryRoot, "tests/helpers/serverOnly.ts"),
      },
    },
    server: { middlewareMode: true, hmr: false },
  });

  const evaluator = await viteServer.ssrLoadModule(evaluatorPath);
  exitCode = await evaluator.runRecommendationEvaluationCli();
} catch {
  process.stderr.write(
    "[RecommendationEvaluation] runner failed EVALUATION_RUNNER_ERROR\n",
  );
} finally {
  if (viteServer) {
    try {
      await viteServer.close();
    } catch {
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
