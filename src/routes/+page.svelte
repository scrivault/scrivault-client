<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, toBase64 } from '$lib/api';
	import {
		createThreadKeys,
		encryptMessage,
		encryptFile,
		hashFile
	} from '$lib/crypto';
	import { pendingPassphrase, threadId, threadKey, threadSalt } from '$lib/stores';

	let topic = $state('');
	let subject = $state('');
	let message = $state('');
	let files: FileList | null = $state(null);
	let submitting = $state(false);
	let error = $state('');

	const topics = [
		'Government & Politics',
		'Corporate Misconduct',
		'Environment & Public Health',
		'Law Enforcement & Justice',
		'Financial Fraud',
		'National Security',
		'Other'
	];

	async function handleSubmit() {
		if (!message.trim()) {
			error = 'A message is required.';
			return;
		}

		submitting = true;
		error = '';

		try {
			// Generate all crypto material client-side
			const keys = await createThreadKeys();

			// Encrypt the message (subject + body combined)
			const plaintext = subject.trim()
				? `[${topic || 'General'}] ${subject.trim()}\n\n${message.trim()}`
				: `[${topic || 'General'}]\n\n${message.trim()}`;

			const encrypted = await encryptMessage(plaintext, keys.derivedKey);

			// Submit encrypted tip to server
			const res = await api.createTip({
				blinded_id: keys.blindedId,
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce),
				salt: toBase64(keys.salt),
				sender_role: 'source'
			});

			// Upload files if any
			if (files && files.length > 0) {
				for (const file of files) {
					const buffer = new Uint8Array(await file.arrayBuffer());
					const hash = await hashFile(buffer);
					const encFile = await encryptFile(buffer, keys.derivedKey);

					// Encrypt the filename
					const encName = await encryptMessage(file.name, keys.derivedKey);

					await api.uploadDocument(res.thread_id, {
						ciphertext: toBase64(encFile.ciphertext),
						nonce: toBase64(encFile.nonce),
						sha256_hash: hash,
						file_size: file.size,
						encrypted_name: toBase64(encName.ciphertext),
						name_nonce: toBase64(encName.nonce)
					});
				}
			}

			// Store session state and navigate to passphrase page
			pendingPassphrase.set(keys.passphrase);
			threadId.set(res.thread_id);
			threadKey.set(keys.derivedKey);
			threadSalt.set(keys.salt);

			goto('/passphrase');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Submission failed. Please try again.';
			submitting = false;
		}
	}

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		files = input.files;
	}
</script>

<svelte:head>
	<title>Submit a Tip — Scrivault</title>
</svelte:head>

<div class="min-h-screen flex flex-col items-center justify-center px-4 py-12">
	<div class="w-full max-w-xl">
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
			<h1 class="text-2xl font-semibold text-vault-text mb-2">Submit a Secure Tip</h1>
			<p class="text-sm text-vault-text-muted max-w-md mx-auto">
				Your message is encrypted in your browser before transmission.
				No account required. No identifying information collected.
			</p>
		</div>

		<!-- E2E badge -->
		<div class="flex justify-center mb-8">
			<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-vault-green/30 bg-vault-green-muted">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-green animate-pulse"></div>
				<span class="font-mono text-xs text-vault-green">End-to-end encrypted</span>
			</div>
		</div>

		<!-- Form -->
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} autocomplete="off" class="space-y-5">
			<!-- Topic -->
			<div>
				<label for="topic" class="block font-mono text-xs text-vault-text-muted mb-1.5 uppercase tracking-wider">
					Topic
				</label>
				<select
					id="topic"
					bind:value={topic}
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
				>
					<option value="">Select a topic (optional)</option>
					{#each topics as t}
						<option value={t}>{t}</option>
					{/each}
				</select>
			</div>

			<!-- Subject -->
			<div>
				<label for="subject" class="block font-mono text-xs text-vault-text-muted mb-1.5 uppercase tracking-wider">
					Subject
				</label>
				<input
					id="subject"
					type="text"
					bind:value={subject}
					placeholder="Brief description (optional)"
					autocomplete="off"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
				/>
			</div>

			<!-- Message -->
			<div>
				<label for="message" class="block font-mono text-xs text-vault-text-muted mb-1.5 uppercase tracking-wider">
					Message <span class="text-vault-red">*</span>
				</label>
				<textarea
					id="message"
					bind:value={message}
					rows={6}
					placeholder="Describe what you know. Be as specific as possible."
					autocomplete="off"
					required
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-y min-h-32"
				></textarea>
			</div>

			<!-- File upload -->
			<div>
				<label for="files" class="block font-mono text-xs text-vault-text-muted mb-1.5 uppercase tracking-wider">
					Attach Files
				</label>
				<div class="border border-dashed border-vault-border rounded-lg p-6 text-center hover:border-vault-text-dim transition-colors">
					<input
						id="files"
						type="file"
						multiple
						onchange={handleFileChange}
						class="hidden"
					/>
					<label for="files" class="cursor-pointer">
						<svg class="w-8 h-8 text-vault-text-dim mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
						</svg>
						<p class="text-sm text-vault-text-muted">
							<span class="text-vault-text underline">Choose files</span> or drag and drop
						</p>
						<p class="text-xs text-vault-text-dim mt-1">Documents, images, or other evidence. Metadata will be stripped.</p>
					</label>
				</div>
				{#if files && files.length > 0}
					<div class="mt-2 space-y-1">
						{#each Array.from(files) as file}
							<div class="flex items-center gap-2 text-xs text-vault-text-muted font-mono">
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
								<span>{file.name}</span>
								<span class="text-vault-text-dim">({(file.size / 1024).toFixed(1)} KB)</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Error -->
			{#if error}
				<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-red-muted border border-vault-red/30">
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
					<span>Encrypting & Submitting…</span>
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
					</svg>
					<span>Submit Securely</span>
				{/if}
			</button>
		</form>

		<!-- Footer -->
		<div class="mt-8 pt-6 border-t border-vault-border-subtle text-center space-y-3">
			<p class="text-xs text-vault-text-dim">
				Your IP address is not logged. No cookies are used.
			</p>
			<a href="/return" class="inline-block text-xs text-vault-text-muted hover:text-vault-text transition-colors underline underline-offset-2">
				Already submitted a tip? Return to your conversation →
			</a>
		</div>
	</div>
</div>
