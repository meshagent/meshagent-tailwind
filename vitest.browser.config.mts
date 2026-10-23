import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  // Browser regressions load the built stylesheet, which needs no PostCSS plugins.
  css: { postcss: { plugins: [] } },
  test: {
    include: ["test/browser/**/*.browser.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
