import * as nextEnv from "@next/env";
import { defineConfig } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:3000",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        reuseExistingServer: true,
        url: "http://localhost:3000/api/v1/health",
      },
});
