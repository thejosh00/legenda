import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  // `*.pw.ts`, never `*.test.ts`: `bun test` does not pick these up, and Playwright picks up nothing else.
  testMatch: ['pages.pw.ts'],
  outputDir: '.playwright/results',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list'], ['html', {outputFolder: '.playwright/report', open: 'never'}]],
  timeout: 60_000,
  expect: {timeout: 10_000},
  use: {trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  projects: [{name: 'desktop-chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}}],
});
