import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3107",
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    screenshot: "only-on-failure",
  },
  webServer: process.env.EXTERNAL_SERVER
    ? undefined
    : {
        command: "node scripts/e2e-server.js",
        url: "http://127.0.0.1:3107",
        reuseExistingServer: false,
      },
  reporter: "list",
});
