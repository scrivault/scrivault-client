<script lang="ts">
	import { goto } from '$app/navigation';
	import { pendingPassphrase, threadId, threadKey } from '$lib/stores';
	import { get } from 'svelte/store';

	let passphrase = $state(get(pendingPassphrase));
	let confirmed = $state(false);
	let writtenDown = $state(false);

	// If no passphrase in store, redirect to home
	if (!passphrase) {
		goto('/');
	}

	const words = passphrase?.split(' ') ?? [];

	function handleConfirm() {
		confirmed = true;
		// Clear the passphrase from memory — it won't be shown again
		pendingPassphrase.set(null);

		const tid = get(threadId);
		if (tid) {
			goto(`/thread/${encodeURIComponent(tid)}`);
		} else {
			goto('/');
		}
	}

	function handlePrint() {
		window.print();
	}
</script>

<svelte:head>
	<title>Save Your Passphrase — Scrivault</title>
</svelte:head>

<div class="min-h-screen flex flex-col items-center justify-center px-4 py-12">
	<div class="w-full max-w-lg">
		<!-- Success indicator -->
		<div class="flex justify-center mb-6">
			<div class="w-14 h-14 rounded-full bg-vault-green/10 flex items-center justify-center">
				<svg class="w-7 h-7 text-vault-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
			</div>
		</div>

		<div class="text-center mb-8">
			<h1 class="text-2xl font-semibold text-vault-text mb-2">Report Submitted Successfully</h1>
			<p class="text-sm text-vault-text-muted">
				Your message has been encrypted and delivered.
			</p>
		</div>

		<!-- Warning -->
		<div class="mb-6 p-4 rounded-lg border border-vault-amber/30 bg-vault-amber-muted">
			<div class="flex items-start gap-3">
				<svg class="w-5 h-5 text-vault-amber shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
				</svg>
				<div>
					<p class="text-sm font-semibold text-vault-amber mb-1">Write this down on paper now</p>
					<p class="text-xs text-vault-text-muted">
						This passphrase is your only way to access this conversation.
						It will not be shown again. Do not save it digitally on a work device.
					</p>
				</div>
			</div>
		</div>

		<!-- Passphrase grid -->
		<div class="mb-6 p-5 rounded-lg bg-vault-surface border border-vault-border">
			<div class="flex items-center justify-between mb-3">
				<div class="text-xs text-vault-text-muted tracking-wide">
					Recovery Passphrase
				</div>
				<button
					onclick={handlePrint}
					class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-vault-text-muted hover:text-vault-text border border-vault-border hover:border-vault-text-dim transition-colors print:hidden"
					title="Print this page"
				>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
					</svg>
					Print
				</button>
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
				{#each words as word, i}
					<div class="flex items-center gap-2 bg-vault-bg rounded px-3 py-2.5 sm:py-2">
						<span class="text-xs text-vault-text-dim font-mono w-4 text-right">{i + 1}.</span>
						<span class="text-sm text-vault-text font-mono font-medium">{word}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- What this passphrase allows -->
		<div class="mb-8 p-4 rounded-lg bg-vault-surface border border-vault-border-subtle">
			<div class="text-xs text-vault-text-muted tracking-wide mb-3">
				This passphrase allows you to
			</div>
			<ul class="space-y-2">
				{#each [
					'Check for responses',
					'Continue the conversation',
					'Upload additional documents',
					'Revoke access to your files'
				] as item}
					<li class="flex items-center gap-2 text-sm text-vault-text-muted">
						<svg class="w-3.5 h-3.5 text-vault-green shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						{item}
					</li>
				{/each}
			</ul>
		</div>

		<!-- Confirmation checkbox -->
		<label class="flex items-start gap-3 mb-4 cursor-pointer group">
			<input
				type="checkbox"
				bind:checked={writtenDown}
				class="mt-0.5 w-4 h-4 rounded border-vault-border bg-vault-surface text-vault-green focus:ring-vault-green/50 focus:ring-2 cursor-pointer"
			/>
			<span class="text-sm text-vault-text-muted group-hover:text-vault-text transition-colors">
				I have written down or printed this passphrase and stored it somewhere safe
			</span>
		</label>

		<!-- Confirm button -->
		<button
			onclick={handleConfirm}
			disabled={!writtenDown}
			class="w-full flex items-center justify-center gap-2 bg-vault-green hover:bg-vault-green-dim text-black font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
			</svg>
			<span>I've saved my passphrase</span>
		</button>

		<p class="mt-4 text-center text-xs text-vault-text-dim">
			If you lose this passphrase, there is no way to recover your conversation.<br />
			This is by design — there is no backdoor.
		</p>
	</div>
</div>
