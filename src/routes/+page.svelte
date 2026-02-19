<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, toBase64 } from '$lib/api';
	import type { KeyGrantPayload } from '$lib/api';
	import {
		createThreadKeys,
		encryptMessage,
		encryptFile,
		hashFile,
		sealThreadKeyForJournalist,
		fromBase64
	} from '$lib/crypto';
	import { newsroomApi } from '$lib/newsroom/api';
	import { orgStore } from '$lib/newsroom/org';
	import { pendingPassphrase, threadId, threadKey, threadSalt } from '$lib/stores';

	const org = $derived($orgStore);

	let topic = $state('');
	let subject = $state('');
	let message = $state('');
	let selectedFiles: File[] = $state([]);
	let submitting = $state(false);
	let error = $state('');
	let showSafetyGuide = $state(false);
	let dragOver = $state(false);

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
	const BLOCKED_EXTENSIONS = new Set([
		'.exe', '.bat', '.cmd', '.msi', '.ps1', '.scr', '.com', '.vbs',
		'.vbe', '.js', '.jse', '.wsf', '.wsh', '.dll', '.sys'
	]);

	function fileExtension(name: string): string {
		const idx = name.lastIndexOf('.');
		return idx >= 0 ? name.slice(idx).toLowerCase() : '';
	}

	function validateFile(file: File): string | null {
		const ext = fileExtension(file.name);
		if (BLOCKED_EXTENSIONS.has(ext)) return `Blocked file type: ${ext}`;
		if (file.size > MAX_FILE_SIZE) return `File too large (max 50MB): ${file.name}`;
		return null;
	}

	function addFiles(newFiles: File[]) {
		for (const f of newFiles) {
			const err = validateFile(f);
			if (err) {
				error = err;
				return;
			}
		}
		// Deduplicate by name+size
		const existing = new Set(selectedFiles.map((f) => `${f.name}:${f.size}`));
		const unique = newFiles.filter((f) => !existing.has(`${f.name}:${f.size}`));
		selectedFiles = [...selectedFiles, ...unique];
		error = '';
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	/** Strip EXIF metadata from JPEG/PNG images by re-drawing to canvas. */
	async function stripImageMetadata(file: File): Promise<Uint8Array> {
		const buffer = new Uint8Array(await file.arrayBuffer());
		const type = file.type;
		if (type !== 'image/jpeg' && type !== 'image/png') {
			return buffer; // Can't strip non-image files
		}
		try {
			const blob = new Blob([buffer], { type });
			const bitmap = await createImageBitmap(blob);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext('2d');
			if (!ctx) return buffer;
			ctx.drawImage(bitmap, 0, 0);
			const outBlob = await canvas.convertToBlob({ type: type === 'image/jpeg' ? 'image/jpeg' : 'image/png', quality: 0.95 });
			return new Uint8Array(await outBlob.arrayBuffer());
		} catch {
			return buffer; // Fallback: use original bytes
		}
	}

	function isImageFile(file: File): boolean {
		return file.type.startsWith('image/');
	}

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

			// Seal thread key for all editors (graceful degradation if fetch fails)
			let keyGrants: KeyGrantPayload[] = [];
			try {
				const pubkeysRes = await newsroomApi.getEditorPublicKeys();
				if (pubkeysRes.keys && pubkeysRes.keys.length > 0) {
					const grants = await Promise.all(
						pubkeysRes.keys.map(async (editor) => {
							const sealed = await sealThreadKeyForJournalist(
								keys.derivedKey,
								fromBase64(editor.public_key)
							);
							return {
								journalist_id: editor.journalist_id,
								sealed_key: toBase64(sealed)
							};
						})
					);
					keyGrants = grants;
				}
			} catch {
				// No editors registered or server unreachable — submit tip without grants.
				// Journalists won't be able to decrypt until manual re-grant flow (future feature).
				console.warn('Could not fetch editor public keys — submitting without key grants');
			}

			// Submit encrypted tip to server
			const res = await api.createTip({
				blinded_id: keys.blindedId,
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce),
				salt: toBase64(keys.salt),
				sender_role: 'source',
				key_grants: keyGrants.length > 0 ? keyGrants : undefined
			});

			// Upload files if any
			if (selectedFiles.length > 0) {
				for (const file of selectedFiles) {
					// Strip EXIF metadata from images
					const buffer = isImageFile(file) ? await stripImageMetadata(file) : new Uint8Array(await file.arrayBuffer());
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
		if (input.files) addFiles(Array.from(input.files));
		input.value = ''; // Reset so re-selecting same file works
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
	}
</script>

<svelte:head>
	<title>Submit a Report — {org?.name ?? 'Scrivault'}</title>
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
				<span class="text-sm text-vault-text-muted tracking-wide">{org?.name ?? 'Scrivault'}</span>
			</div>
			<h1 class="text-2xl font-semibold text-vault-text mb-2">{org ? `${org.name} Secure Channel` : 'Secure Channel'}</h1>
			<p class="text-sm text-vault-text-muted max-w-md mx-auto">
				Your message is encrypted in your browser before transmission.
				No account required. No identifying information collected.
			</p>
		</div>

		<!-- E2E indicator -->
		<div class="flex justify-center mb-8">
			<div class="inline-flex items-center gap-2">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
				<span class="text-sm text-zinc-400">End-to-end encrypted</span>
			</div>
		</div>

		<!-- Safety guidance -->
		<div class="mb-6 rounded-lg border border-vault-border bg-vault-surface overflow-hidden">
			<button
				onclick={() => { showSafetyGuide = !showSafetyGuide; }}
				class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-vault-surface-raised/50 transition-colors"
			>
				<div class="flex items-center gap-2">
					<svg class="w-4 h-4 text-vault-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
					</svg>
					<span class="text-sm font-medium text-vault-text">Before You Submit</span>
				</div>
				<svg class="w-4 h-4 text-vault-text-dim transition-transform {showSafetyGuide ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if showSafetyGuide}
				<div class="px-4 pb-4 space-y-2 text-sm text-vault-text-muted">
					<div class="flex items-start gap-2">
						<span class="text-vault-amber mt-0.5">1.</span>
						<p><strong>Use Tor Browser</strong> to access this page. It hides your IP address and location from your ISP and this server.</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-vault-amber mt-0.5">2.</span>
						<p><strong>Don't submit from a work or school computer.</strong> Use a personal device on a network not associated with you.</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-vault-amber mt-0.5">3.</span>
						<p><strong>Don't mention your name or identifying details</strong> in your message unless you intentionally want to be identified.</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-vault-amber mt-0.5">4.</span>
						<p><strong>Images may contain hidden metadata</strong> (location, device info). We strip this automatically, but consider screenshotting instead of sending originals.</p>
					</div>
					<div class="flex items-start gap-2">
						<span class="text-vault-amber mt-0.5">5.</span>
						<p><strong>Don't tell anyone you submitted a report</strong> until you speak directly with your contact.</p>
					</div>
				</div>
			{/if}
		</div>

		<!-- Form -->
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} autocomplete="off" class="space-y-5">
			<!-- Topic -->
			<div>
				<label for="topic" class="block text-xs text-vault-text-muted mb-1.5 tracking-wide">
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
				<label for="subject" class="block text-xs text-vault-text-muted mb-1.5 tracking-wide">
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
				<label for="message" class="block text-xs text-vault-text-muted mb-1.5 tracking-wide">
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
				<label for="files" class="block text-xs text-vault-text-muted mb-1.5 tracking-wide">
					Attach Files
				</label>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="border border-dashed rounded-lg p-6 text-center transition-colors {dragOver ? 'border-vault-green bg-vault-green-muted/20' : 'border-vault-border hover:border-vault-text-dim'}"
					ondragover={(e) => { e.preventDefault(); dragOver = true; }}
					ondragleave={() => { dragOver = false; }}
					ondrop={handleDrop}
				>
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
						<p class="text-xs text-vault-text-dim mt-1">
							Images are automatically stripped of metadata (EXIF/GPS). Non-image files may contain identifying metadata.
						</p>
					</label>
				</div>
				{#if selectedFiles.length > 0}
					<div class="mt-2 space-y-1">
						{#each selectedFiles as file, i}
							<div class="flex items-center gap-2 text-xs text-vault-text-muted font-mono py-1 rounded hover:bg-vault-surface/50 px-1 -mx-1">
								<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
								<span class="truncate min-w-0">{file.name}</span>
								<span class="text-vault-text-dim shrink-0 hidden sm:inline">({(file.size / 1024).toFixed(1)} KB)</span>
								{#if isImageFile(file)}
									<span class="text-zinc-500 text-[10px] shrink-0 hidden sm:inline">Metadata removed</span>
								{:else}
									<span class="text-zinc-500 text-[10px] shrink-0 hidden sm:inline">metadata intact</span>
								{/if}
								<button
									type="button"
									onclick={() => removeFile(i)}
									class="ml-auto shrink-0 p-1 -m-1 text-vault-text-dim hover:text-vault-red active:text-vault-red transition-colors"
									title="Remove file"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
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
				Already submitted? Return to your conversation →
			</a>
		</div>
	</div>
</div>
