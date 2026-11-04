import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: [["list"], ["html", {open: "never"}]],
  use: {
    baseURL: "http://127.0.0.1:4177",
    viewport: {width: 1440, height: 1000},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tools/serve.mjs",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: false,
  },
});
