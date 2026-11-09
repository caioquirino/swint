import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/web-e2e/test-output',
  // One shared Keycloak and dev stack: run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: '../../dist/.playwright/apps/web-e2e/report', open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm nx run-many -t serve -p api web --output-style=stream',
        // Through the Vite proxy, so it is ready only when both the web and API servers are.
        url: 'http://localhost:4200/api/openapi.json',
        reuseExistingServer: true,
        timeout: 180_000,
        cwd: workspaceRoot,
        // Applies only when Playwright starts the servers itself; tests tolerate the 60 s default.
        env: { COLLAB_REVALIDATE_MS: '2000' },
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
