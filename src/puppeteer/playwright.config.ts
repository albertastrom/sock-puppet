import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:18888",
    viewport: { width: 1400, height: 1100 },
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: [
    {
      command: "npm run start",
      url: "http://127.0.0.1:18888",
      env: {
        PORT: "18888",
        ROBOT_WS_PORT: "18887",
        TWIN_ORIGIN: "http://127.0.0.1:15173",
        OPENAI_API_KEY: "",
      },
      reuseExistingServer: false,
    },
    {
      command: "npm --prefix ../digital-twin run dev -- --port 15173",
      url: "http://127.0.0.1:15173",
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});
