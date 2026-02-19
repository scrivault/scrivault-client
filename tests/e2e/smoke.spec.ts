import { test, expect } from '@playwright/test';

/**
 * Smoke test — verifies the application loads and the API is reachable.
 * Run first to catch infrastructure issues before the full E2E suite.
 */

test.describe('Smoke tests', () => {
	test('homepage loads', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('h1')).toBeVisible({ timeout: 15_000 });
	});

	test('API health endpoint returns ok', async ({ request }) => {
		const res = await request.get('/healthz');
		expect(res.status()).toBe(200);

		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.database).toBe('ok');
	});

	test('setup status endpoint returns', async ({ request }) => {
		const res = await request.get('/api/setup/status');
		expect(res.status()).toBe(200);

		const body = await res.json();
		// needs_setup is either true (fresh DB) or false (already set up)
		expect(typeof body.needs_setup).toBe('boolean');
	});
});
