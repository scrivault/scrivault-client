import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Full round-trip E2E test for Scrivault.
 *
 * Flow:
 *   1. First-run setup (create org + editor account)
 *   2. Source submits an encrypted tip via the homepage
 *   3. Source sees passphrase, saves words, views thread
 *   4. Editor logs in, sees tip, decrypts, and replies
 *   5. Source returns using passphrase and sees reply
 *
 * Prerequisites:
 *   - Fresh database (no existing org/journalists)
 *   - Go API server running on localhost:8080
 *   - SvelteKit dev server running on localhost:5173
 */

const TEST_ORG = 'Test Newsroom';
const TEST_ORG_SLUG = 'test-newsroom';
const EDITOR_EMAIL = 'editor@test.local';
const EDITOR_NAME = 'Test Editor';
const EDITOR_PASSWORD = 'TestPassword123!secure';
const SOURCE_MESSAGE = 'This is a confidential test tip about corruption in the testing department.';
const EDITOR_REPLY = 'Thank you for your tip. We are investigating this matter.';

// State shared across sequential tests
let savedPassphraseWords: string[] = [];
let savedThreadId = '';

test.describe.serial('Full round-trip', () => {
	// ─── Step 1: First-run setup ────────────────────────────────

	test('1. complete first-run setup wizard', async ({ page }) => {
		// Check if setup is needed
		const statusRes = await page.request.get('/api/setup/status');
		const status = await statusRes.json();

		if (!status.needs_setup) {
			test.skip(true, 'Organization already set up — skipping setup');
			return;
		}

		await page.goto('/setup');
		await expect(page.locator('h1')).toContainText(/setup|welcome/i, { timeout: 15_000 });

		// Fill organization details
		await page.getByLabel(/organization name/i).fill(TEST_ORG);
		const slugField = page.getByLabel(/slug/i);
		if (await slugField.isVisible()) {
			await slugField.fill(TEST_ORG_SLUG);
		}

		// Fill admin account details
		await page.getByLabel(/display name/i).fill(EDITOR_NAME);
		await page.getByLabel(/email/i).fill(EDITOR_EMAIL);

		// Password fields
		const passwordFields = page.locator('input[type="password"]');
		await passwordFields.nth(0).fill(EDITOR_PASSWORD);
		if ((await passwordFields.count()) > 1) {
			await passwordFields.nth(1).fill(EDITOR_PASSWORD);
		}

		// Submit
		const submitBtn = page.getByRole('button', { name: /create|set up|submit/i });
		await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
		await submitBtn.click();

		// Should redirect to newsroom dashboard after setup
		await expect(page).toHaveURL(/\/newsroom/, { timeout: 30_000 });
	});

	// ─── Step 2+3: Source submits tip and saves passphrase ──────
	// These MUST share a page context because the passphrase page
	// reads from in-memory Svelte stores that don't survive navigation.

	test('2. source submits tip, saves passphrase, and views thread', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('h1')).toBeVisible({ timeout: 15_000 });

		// Select a topic if dropdown is present
		const topicSelect = page.locator('select');
		if (await topicSelect.isVisible()) {
			await topicSelect.selectOption({ index: 1 });
		}

		// Fill subject if visible
		const subjectField = page.getByLabel(/subject/i);
		if (await subjectField.isVisible().catch(() => false)) {
			await subjectField.fill('Test Tip Subject');
		}

		// Fill message
		const messageArea = page.locator('textarea');
		await expect(messageArea).toBeVisible();
		await messageArea.fill(SOURCE_MESSAGE);

		// Submit the tip
		const submitBtn = page.getByRole('button', { name: /submit|send/i });
		await expect(submitBtn).toBeEnabled();
		await submitBtn.click();

		// Wait for crypto + submission to complete → passphrase page
		await expect(page).toHaveURL(/\/passphrase/, { timeout: 60_000 });
		await expect(page.locator('h1')).toContainText(/submitted|passphrase/i, { timeout: 15_000 });

		// ── Extract passphrase words ────────────────────────────
		// Words are rendered in a grid, each in its own element.
		// Try multiple strategies to find them.

		// Strategy 1: Look for numbered word elements (e.g., "1. abandon")
		const allText = await page.textContent('body') ?? '';

		// Strategy 2: Use evaluate to extract from the DOM more precisely
		const extractedWords = await page.evaluate(() => {
			// Look for the passphrase grid — it's typically a grid of spans
			const gridElements = document.querySelectorAll('[class*="grid"] span, [class*="grid"] div');
			const words: string[] = [];

			for (const el of gridElements) {
				const text = el.textContent?.trim().toLowerCase() ?? '';
				// BIP39 words are 3-8 lowercase letters
				if (/^[a-z]{3,8}$/.test(text)) {
					words.push(text);
				}
			}

			if (words.length >= 12) return words.slice(0, 12);

			// Fallback: look for any elements that look like passphrase words
			// They're often adjacent to numbering (1, 2, 3...)
			const allSpans = document.querySelectorAll('span, code');
			const fallbackWords: string[] = [];
			for (const el of allSpans) {
				const text = el.textContent?.trim().toLowerCase() ?? '';
				if (/^[a-z]{3,8}$/.test(text) && !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'new', 'now', 'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say', 'she', 'too', 'use'].includes(text)) {
					fallbackWords.push(text);
				}
			}
			return fallbackWords.slice(0, 12);
		});

		if (extractedWords.length >= 12) {
			savedPassphraseWords = extractedWords.slice(0, 12);
		} else {
			// Last resort: regex scan the full page text for BIP39-like words
			const bip39Matches = allText.match(/\b[a-z]{3,8}\b/g) ?? [];
			savedPassphraseWords = bip39Matches.slice(0, 12);
		}

		expect(savedPassphraseWords.length).toBe(12);
		console.log(`[E2E] Captured passphrase: ${savedPassphraseWords.join(' ')}`);

		// ── Confirm and navigate to thread ──────────────────────
		const checkbox = page.getByRole('checkbox');
		if ((await checkbox.count()) > 0) {
			await checkbox.first().check();
		}

		const confirmBtn = page.getByRole('button', { name: /confirm|continue|i.ve saved/i });
		if (await confirmBtn.isVisible()) {
			await confirmBtn.click();
		}

		// Should redirect to thread view
		await expect(page).toHaveURL(/\/thread\//, { timeout: 15_000 });

		// Capture thread ID from URL
		const url = page.url();
		const threadMatch = url.match(/\/thread\/([^/?]+)/);
		expect(threadMatch).toBeTruthy();
		savedThreadId = decodeURIComponent(threadMatch![1]);
		console.log(`[E2E] Thread ID: ${savedThreadId}`);

		// Verify the source can see their own decrypted message
		await expect(page.locator('body')).toContainText(/corruption/i, { timeout: 30_000 });
	});

	// ─── Step 4: Editor logs in and decrypts the tip ─────────────

	test('3. editor logs in, sees and decrypts tip', async ({ page }) => {
		expect(savedThreadId).toBeTruthy();

		await loginAsEditor(page);

		// Navigate to tips list
		await page.goto('/newsroom/tips');
		await page.waitForLoadState('networkidle');

		// Should see at least one tip
		const tipRows = page.locator('table tr, [role="row"], a[href*="tips/"]');
		await expect(tipRows.first()).toBeVisible({ timeout: 15_000 });

		// Navigate to the specific thread
		await page.goto(`/newsroom/tips/${savedThreadId}`);
		await page.waitForLoadState('networkidle');

		// Wait for decryption — the decrypted message should appear
		await expect(page.locator('body')).toContainText(SOURCE_MESSAGE, { timeout: 30_000 });
	});

	// ─── Step 5: Editor sends a reply ───────────────────────────

	test('4. editor sends encrypted reply', async ({ page }) => {
		expect(savedThreadId).toBeTruthy();

		await loginAsEditor(page);

		await page.goto(`/newsroom/tips/${savedThreadId}`);
		await page.waitForLoadState('networkidle');

		// Wait for thread to load and decrypt
		await expect(page.locator('body')).toContainText(SOURCE_MESSAGE, { timeout: 30_000 });

		// Find reply textarea and type the reply
		const replyArea = page.locator('textarea');
		await expect(replyArea).toBeVisible({ timeout: 10_000 });
		await replyArea.fill(EDITOR_REPLY);

		// Send the reply
		const sendBtn = page.getByRole('button', { name: /send|reply/i });
		await expect(sendBtn).toBeEnabled();
		await sendBtn.click();

		// Wait for the reply to appear in the thread (decrypted)
		await expect(page.locator('body')).toContainText(EDITOR_REPLY, { timeout: 30_000 });
	});

	// ─── Step 6: Source returns and sees the reply ───────────────

	test('5. source returns using passphrase and sees reply', async ({ page }) => {
		expect(savedPassphraseWords.length).toBe(12);

		await page.goto('/return');
		await expect(page.locator('h1, h2')).toContainText(/return|recover|check/i, { timeout: 15_000 });

		// Fill in the 12 passphrase words
		// The return page has inputs with id="word-0" through id="word-11"
		for (let i = 0; i < 12; i++) {
			const wordInput = page.locator(`#word-${i}`);
			if (await wordInput.isVisible()) {
				await wordInput.fill(savedPassphraseWords[i]);
			} else {
				// Fallback: fill nth input
				await page.locator('input[type="text"]').nth(i).fill(savedPassphraseWords[i]);
			}
		}

		// Submit the passphrase
		const submitBtn = page.getByRole('button', { name: /recover|view|check|submit/i });
		await expect(submitBtn).toBeEnabled();
		await submitBtn.click();

		// Should navigate to thread view — key derivation takes time (Argon2id)
		await expect(page).toHaveURL(/\/thread\//, { timeout: 60_000 });

		// Source should see both the original message and the editor's reply
		await expect(page.locator('body')).toContainText(EDITOR_REPLY, { timeout: 30_000 });
	});
});

// ─── Helper: login as editor ────────────────────────────────────

async function loginAsEditor(page: Page): Promise<void> {
	await page.goto('/newsroom/login');

	const emailField = page.getByLabel(/email/i);
	await expect(emailField).toBeVisible({ timeout: 15_000 });
	await emailField.fill(EDITOR_EMAIL);
	await page.locator('input[type="password"]').fill(EDITOR_PASSWORD);

	const loginBtn = page.getByRole('button', { name: /log in|sign in/i });
	await loginBtn.click();

	// Wait for auth + key decryption to complete
	await expect(page).toHaveURL(/\/newsroom/, { timeout: 30_000 });
}
