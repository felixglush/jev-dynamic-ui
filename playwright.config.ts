import { defineConfig } from "@playwright/test";

import { ANNOTATIONS_FILE, PREDICTIONS_LOG, SFT_REVIEW_FILE } from "./e2e/paths";

// Something else may hold 3100 on a dev machine; PW_APP_PORT picks another.
const APP_PORT = Number(process.env.PW_APP_PORT ?? 3100);
const FAKE_JEV_PORT = 8787;
const FAKE_OLLAMA_PORT = 8788;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // The SDK retries a failing API call a couple of times before giving up, so the error test is slow.
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    // Set PW_CHROMIUM_PATH to use an already-installed Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      // The stand-in for the TypeSafe API.
      command: "node e2e/fake-jev.mts",
      env: { FAKE_JEV_PORT: String(FAKE_JEV_PORT) },
      url: `http://localhost:${FAKE_JEV_PORT}`,
      // The fake only answers POST, so a plain "is the port open" check is what we want.
      reuseExistingServer: true,
      stdout: "pipe",
      wait: { stdout: /fake Jev listening/ },
    },
    {
      // The stand-in for Ollama, which runs the LiquidFM extractor.
      command: "node e2e/fake-ollama.mts",
      env: { FAKE_OLLAMA_PORT: String(FAKE_OLLAMA_PORT) },
      url: `http://localhost:${FAKE_OLLAMA_PORT}`,
      reuseExistingServer: true,
      stdout: "pipe",
      wait: { stdout: /fake Ollama listening/ },
    },
    {
      // The real app, built for production, pointed at the fake.
      command: `npm run build && npm run start -- -p ${APP_PORT}`,
      env: {
        TYPESAFE_API_KEY: "test-key",
        TYPESAFE_BASE_URL: `http://localhost:${FAKE_JEV_PORT}`,
        OLLAMA_URL: `http://127.0.0.1:${FAKE_OLLAMA_PORT}`,
        ANNOTATIONS_FILE,
        PREDICTIONS_FILE: "e2e/fixtures/predictions.csv",
        PREDICTIONS_LOG_FILE: PREDICTIONS_LOG,
        SFT_REVIEW_FILE,
      },
      url: `http://localhost:${APP_PORT}`,
      // Never reuse: a server started elsewhere wouldn't have ANNOTATIONS_FILE set and would write to data/.
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
