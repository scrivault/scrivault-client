<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, fromBase64 } from '$lib/api';
	import {
		validatePassphrase,
		deriveBlindedId,
		recoverThreadKeys,
		ensureReady
	} from '$lib/crypto';
	import { threadId, threadKey, threadSalt } from '$lib/stores';

	let passphraseWords: string[] = $state(Array(12).fill(''));
	let submitting = $state(false);
	let error = $state('');

	function handleWordInput(index: number, e: Event) {
		const input = e.target as HTMLInputElement;
		let value = input.value.trim().toLowerCase();

		// Handle paste of full passphrase
		const parts = value.split(/\s+/);
		if (parts.length > 1) {
			const newWords = [...passphraseWords];
			for (let i = 0; i < Math.min(parts.length, 12 - index); i++) {
				newWords[index + i] = parts[i];
			}
			passphraseWords = newWords;
			// Focus the last filled input or the next empty one
			const nextIndex = Math.min(index + parts.length, 11);
			const nextInput = document.getElementById(`word-${nextIndex}`) as HTMLInputElement;
			nextInput?.focus();
			return;
		}

		passphraseWords[index] = value;
	}

	function handleKeyDown(index: number, e: KeyboardEvent) {
		// Advance to next field on Space or Tab
		if (e.key === ' ' || e.key === 'Spacebar') {
			e.preventDefault();
			if (passphraseWords[index] && index < 11) {
				const next = document.getElementById(`word-${index + 1}`) as HTMLInputElement;
				next?.focus();
			}
		}
		// Go back on Backspace in an empty field
		if (e.key === 'Backspace' && !passphraseWords[index] && index > 0) {
			const prev = document.getElementById(`word-${index - 1}`) as HTMLInputElement;
			prev?.focus();
		}
	}

	async function handleSubmit() {
		const passphrase = passphraseWords.join(' ').trim();

		if (passphraseWords.some((w) => !w)) {
			error = 'Please enter all 12 words.';
			return;
		}

		submitting = true;
		error = '';

		try {
			await ensureReady();

			// Validate BIP39 format
			const isValid = await validatePassphrase(passphrase);
			if (!isValid) {
				error = 'Invalid passphrase. Please check your words and try again.';
				submitting = false;
				return;
			}

			// Derive blinded ID and look up the thread
			const blindedId = await deriveBlindedId(passphrase);
			const tipData = await api.getTip(blindedId);

			// Recover full keys using the salt from the server
			const salt = fromBase64(tipData.salt);
			const keys = await recoverThreadKeys(passphrase, salt);

			// Store in session
			threadId.set(tipData.thread_id);
			threadKey.set(keys.derivedKey);
			threadSalt.set(keys.salt);

			goto(`/thread/${encodeURIComponent(tipData.thread_id)}`);
		} catch (err) {
			if (err instanceof Error && err.message.includes('not found')) {
				error = 'No conversation found for this passphrase. Please check your words.';
			} else {
				error = err instanceof Error ? err.message : 'Failed to access conversation.';
			}
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Return to Conversation — Scrivault</title>
</svelte:head>

<div class="min-h-screen flex flex-col items-center justify-center px-4 py-12">
	<div class="w-full max-w-lg">
		<!-- Header -->
		<div class="mb-10 text-center">
			<div class="inline-flex items-center gap-2 mb-6">
				<div class="w-8 h-8 rounded bg-vault-green/20 flex items-center justify-center">
					<svg class="w-4 h-4 text-vault-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
					</svg>
				</div>
				<span class="font-mono text-sm text-vault-text-muted tracking-wider uppercase">Scrivault</span>
			</div>
			<h1 class="text-2xl font-semibold text-vault-text mb-2">Return to Your Conversation</h1>
			<p class="text-sm text-vault-text-muted">
				Enter the 12-word passphrase you received when you submitted your tip.
			</p>
		</div>

		<!-- Passphrase form -->
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} autocomplete="off">
			<div class="mb-6 p-5 rounded-lg bg-vault-surface border border-vault-border">
				<div class="font-mono text-xs text-vault-text-muted uppercase tracking-wider mb-3">
					Recovery Passphrase
				</div>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
					{#each passphraseWords as word, i}
						<div class="flex items-center gap-1.5 bg-vault-bg rounded px-2 py-2.5 sm:py-1.5 border border-vault-border-subtle focus-within:border-vault-green/50 transition-colors">
							<span class="text-xs text-vault-text-dim font-mono w-4 text-right shrink-0">{i + 1}.</span>
							<input
								id={`word-${i}`}
								type="text"
								value={word}
								oninput={(e) => handleWordInput(i, e)}
								onkeydown={(e) => handleKeyDown(i, e)}
								autocomplete="off"
								autocapitalize="off"
								spellcheck={false}
								class="w-full bg-transparent text-sm text-vault-text font-mono outline-none"
								placeholder="···"
							/>
						</div>
					{/each}
				</div>
			</div>

			<!-- Error -->
			{#if error}
				<div class="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-red-muted border border-vault-red/30">
					<svg class="w-4 h-4 text-vault-red shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span class="text-sm text-vault-red">{error}</span>
				</div>
			{/if}

			<!-- Submit -->
			<button
				type="submit"
				disabled={submitting}
				class="w-full flex items-center justify-center gap-2 bg-vault-green hover:bg-vault-green-dim text-black font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if submitting}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span>Decrypting…</span>
				{:else}
					<span>Access Conversation</span>
				{/if}
			</button>
		</form>

		<!-- Footer -->
		<div class="mt-8 pt-6 border-t border-vault-border-subtle text-center space-y-3">
			<p class="text-xs text-vault-text-dim">
				Forgot your passphrase? You'll need to submit a new tip.<br />
				We cannot recover lost passphrases.
			</p>
			<a href="/" class="inline-block text-xs text-vault-text-muted hover:text-vault-text transition-colors underline underline-offset-2">
				← Submit a new tip
			</a>
		</div>
	</div>
</div>
