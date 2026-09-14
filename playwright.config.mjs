import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests', testMatch: 'ui.spec.mjs', workers: 1, reporter: 'list',
  outputDir: resolve(process.env.FIGMA_AGENT_TEST_OUTPUT ?? 'work/verification', 'playwright'),
  use: { browserName: 'chromium', headless: true, launchOptions: { executablePath: process.env.FIGMA_AGENT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
});
