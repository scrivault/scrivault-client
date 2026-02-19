import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Scrivault.
 *
 * Expects:
 *   - Go API server running on localhost:8080
 *   - SvelteKit dev server running on localhost:5173 (started by webServer below)
 *   - PostgreSQL running on localhost:5432
 *
 * Run with:
 *   pnpm --filter @scrivault/client test:e2e
 *
 * Or via the ops test runner:
 *   cd scrivault-ops && ./scripts/test-e2e.sh
 */
export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false, // Tests share database state; run sequentially
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1, // Single worker — tests depend on ordered DB state
	reporter: process.env.CI ? 'github' : 'html',
	timeout: 60_000, // 60s per test — Argon2id key derivation is slow

	use: {
		baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	/* Start the SvelteKit dev server before tests if not already running.
	 * The Go API must be started separately (via Docker or manually). */
	webServer: process.env.E2E_SKIP_WEBSERVER
		? undefined
		: {
				command: 'pnpm dev',
				port: 5173,
				reuseExistingServer: !process.env.CI,
				timeout: 30_000,
			},
});
