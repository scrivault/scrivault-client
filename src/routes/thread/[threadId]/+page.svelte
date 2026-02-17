<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { api, toBase64, fromBase64, type MessagePayload } from '$lib/api';
	import {
		decryptMessage,
		decryptFile,
		encryptMessage,
		encryptFile,
		hashFile,
		ensureReady
	} from '$lib/crypto';
	import { threadId, threadKey, threadSalt } from '$lib/stores';

	// ── State ────────────────────────────────────────────────────

	interface DecryptedMessage {
		id: string;
		text: string;
		senderRole: 'source' | 'journalist';
		ordinal: number;
		createdAt: string;
	}

	interface DecryptedDocument {
		id: string;
		fileName: string;
		fileSize: number;
		sha256Hash: string;
		blobUrl: string | null;
		mimeType: string;
		isImage: boolean;
		createdAt: string;
		loading: boolean;
		error: string;
	}

	let messages: DecryptedMessage[] = $state([]);
	let documents: DecryptedDocument[] = $state([]);
	let replyText = $state('');
	let files: FileList | null = $state(null);
	let sending = $state(false);
	let loading = $state(true);
	let error = $state('');
	let loadError = $state('');

	const currentThreadId = $derived($page.params.threadId ?? '');
	const shortHash = $derived(currentThreadId.slice(0, 12));

	// ── Helpers ──────────────────────────────────────────────────

	const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

	function getExtension(name: string): string {
		const parts = name.split('.');
		return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
	}

	function getMimeType(name: string): string {
		const ext = getExtension(name);
		const map: Record<string, string> = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			webp: 'image/webp',
			svg: 'image/svg+xml',
			bmp: 'image/bmp',
			pdf: 'application/pdf',
			txt: 'text/plain',
			json: 'application/json',
			csv: 'text/csv',
		};
		return map[ext] ?? 'application/octet-stream';
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	// ── Load & decrypt messages + documents ──────────────────────

	async function loadMessages() {
		const key = get(threadKey);
		if (!key) {
			goto('/return');
			return;
		}

		loading = true;
		loadError = '';

		try {
			await ensureReady();
			const tipData = await api.getTip(currentThreadId);

			// Decrypt messages
			const decrypted: DecryptedMessage[] = [];
			for (const msg of tipData.messages) {
				try {
					const text = await decryptMessage(
						fromBase64(msg.ciphertext),
						fromBase64(msg.nonce),
						key
					);
					decrypted.push({
						id: msg.id,
						text,
						senderRole: msg.sender_role,
						ordinal: msg.ordinal,
						createdAt: msg.created_at
					});
				} catch {
					decrypted.push({
						id: msg.id,
						text: '[Unable to decrypt this message]',
						senderRole: msg.sender_role,
						ordinal: msg.ordinal,
						createdAt: msg.created_at
					});
				}
			}
			messages = decrypted;

			// Discover documents from provenance chain
			try {
				const provenance = await api.getProvenance(currentThreadId);
				const docIds = provenance.entries
					.filter((e) => e.event_type === 'document_uploaded')
					.map((e) => (e.event_data as Record<string, string>).document_id)
					.filter((id): id is string => !!id);

				// Fetch and decrypt each document's metadata
				const docs: DecryptedDocument[] = [];
				for (const docId of docIds) {
					try {
						const docData = await api.getDocument(docId);
						let fileName = `document-${docId.slice(0, 8)}`;
						if (docData.encrypted_name && docData.name_nonce) {
							try {
								fileName = await decryptMessage(
									fromBase64(docData.encrypted_name),
									fromBase64(docData.name_nonce),
									key
								);
							} catch {
								// Use fallback name
							}
						}

						const ext = getExtension(fileName);
						const isImage = IMAGE_EXTENSIONS.has(ext);
						const mimeType = getMimeType(fileName);

						const doc: DecryptedDocument = {
							id: docData.id,
							fileName,
							fileSize: docData.file_size,
							sha256Hash: docData.sha256_hash,
							blobUrl: null,
							mimeType,
							isImage,
							createdAt: docData.created_at,
							loading: isImage, // auto-decrypt images
							error: ''
						};
						docs.push(doc);

						// Auto-decrypt images inline
						if (isImage) {
							decryptAndDisplayDoc(doc, docData.ciphertext, docData.nonce, key);
						}
					} catch {
						// Skip documents that fail to fetch
					}
				}
				documents = docs;
			} catch {
				// Provenance fetch failed — not critical, just no documents shown
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load messages.';
		} finally {
			loading = false;
		}
	}

	async function decryptAndDisplayDoc(
		doc: DecryptedDocument,
		ciphertextB64: string,
		nonceB64: string,
		key: Uint8Array
	) {
		try {
			const plainBytes = await decryptFile(
				fromBase64(ciphertextB64),
				fromBase64(nonceB64),
				key
			);
			const blob = new Blob([plainBytes], { type: doc.mimeType });
			doc.blobUrl = URL.createObjectURL(blob);
			doc.loading = false;
			// Trigger reactivity
			documents = [...documents];
		} catch {
			doc.error = 'Failed to decrypt';
			doc.loading = false;
			documents = [...documents];
		}
	}

	async function handleDownload(doc: DecryptedDocument) {
		const key = get(threadKey);
		if (!key) return;

		// If we already have the blob, download it
		if (doc.blobUrl) {
			triggerDownload(doc.blobUrl, doc.fileName);
			return;
		}

		// Otherwise fetch, decrypt, and download
		doc.loading = true;
		documents = [...documents];

		try {
			await ensureReady();
			const docData = await api.getDocument(doc.id);
			const plainBytes = await decryptFile(
				fromBase64(docData.ciphertext),
				fromBase64(docData.nonce),
				key
			);
			const blob = new Blob([plainBytes], { type: doc.mimeType });
			const url = URL.createObjectURL(blob);
			doc.blobUrl = url;
			doc.loading = false;
			documents = [...documents];
			triggerDownload(url, doc.fileName);
		} catch {
			doc.error = 'Failed to decrypt';
			doc.loading = false;
			documents = [...documents];
		}
	}

	function triggerDownload(url: string, filename: string) {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	// Load on mount
	$effect(() => {
		if (currentThreadId) {
			loadMessages();
		}
	});

	// Cleanup blob URLs on destroy
	$effect(() => {
		return () => {
			for (const doc of documents) {
				if (doc.blobUrl) URL.revokeObjectURL(doc.blobUrl);
			}
		};
	});

	// ── Send reply ───────────────────────────────────────────────

	async function handleSend() {
		const key = get(threadKey);
		if (!key || !replyText.trim()) return;

		sending = true;
		error = '';

		try {
			await ensureReady();
			const encrypted = await encryptMessage(replyText.trim(), key);

			await api.addMessage(currentThreadId, {
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce),
				sender_role: 'source'
			});

			// Upload files if any
			if (files && files.length > 0) {
				for (const file of files) {
					const buffer = new Uint8Array(await file.arrayBuffer());
					const hash = await hashFile(buffer);
					const encFile = await encryptFile(buffer, key);
					const encName = await encryptMessage(file.name, key);

					await api.uploadDocument(currentThreadId, {
						ciphertext: toBase64(encFile.ciphertext),
						nonce: toBase64(encFile.nonce),
						sha256_hash: hash,
						file_size: file.size,
						encrypted_name: toBase64(encName.ciphertext),
						name_nonce: toBase64(encName.nonce)
					});
				}
			}

			replyText = '';
			files = null;
			const fileInput = document.getElementById('thread-files') as HTMLInputElement;
			if (fileInput) fileInput.value = '';

			await loadMessages();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to send message.';
		} finally {
			sending = false;
		}
	}

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		files = input.files;
	}

	function formatTime(iso: string): string {
		const date = new Date(iso);
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		}) + ', ' + date.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Conversation — Scrivault</title>
</svelte:head>

<div class="min-h-screen flex flex-col max-w-2xl mx-auto px-4">
	<!-- Header bar -->
	<header class="sticky top-0 z-10 bg-vault-bg/95 backdrop-blur-sm border-b border-vault-border-subtle py-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/" aria-label="Back to home" class="text-vault-text-muted hover:text-vault-text transition-colors">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
					</svg>
				</a>
				<div>
					<h1 class="text-sm font-semibold text-vault-text">Secure Conversation</h1>
					<span class="font-mono text-xs text-vault-text-dim">{shortHash}…</span>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-vault-green/30 bg-vault-green-muted">
					<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
					<span class="font-mono text-[10px] text-vault-green">ENCRYPTED</span>
				</div>
			</div>
		</div>
	</header>

	<!-- Messages area -->
	<div class="flex-1 py-6 space-y-4">
		{#if loading}
			<div class="flex items-center justify-center py-20">
				<div class="flex items-center gap-3 text-vault-text-muted">
					<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="text-sm">Decrypting messages…</span>
				</div>
			</div>
		{:else if loadError}
			<div class="flex items-center justify-center py-20">
				<div class="text-center">
					<p class="text-sm text-vault-red mb-4">{loadError}</p>
					<button
						onclick={loadMessages}
						class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
					>
						Try again
					</button>
				</div>
			</div>
		{:else if messages.length === 0 && documents.length === 0}
			<div class="flex items-center justify-center py-20 text-sm text-vault-text-dim">
				No messages yet.
			</div>
		{:else}
			<!-- Messages -->
			{#each messages as msg (msg.id)}
				{@const isSource = msg.senderRole === 'source'}
				<div class="flex {isSource ? 'justify-start' : 'justify-end'}">
					<div class="max-w-[80%] {isSource ? 'bg-vault-surface border border-vault-border' : 'bg-vault-green-muted border border-vault-green/20'} rounded-lg px-4 py-3">
						<!-- Sender label -->
						<div class="flex items-center gap-2 mb-1.5">
							<span class="font-mono text-[10px] uppercase tracking-wider {isSource ? 'text-vault-text-muted' : 'text-vault-green/70'}">
								{isSource ? 'You' : 'Journalist'}
							</span>
							<span class="text-[10px] text-vault-text-dim">
								{formatTime(msg.createdAt)}
							</span>
						</div>
						<!-- Message body -->
						<p class="text-sm text-vault-text whitespace-pre-wrap break-words">{msg.text}</p>
					</div>
				</div>
			{/each}

			<!-- Documents -->
			{#if documents.length > 0}
				<div class="pt-2">
					<div class="font-mono text-[10px] text-vault-text-dim uppercase tracking-wider mb-3 flex items-center gap-2">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
						</svg>
						Attachments ({documents.length})
					</div>
					<div class="space-y-3">
						{#each documents as doc (doc.id)}
							<div class="rounded-lg bg-vault-surface border border-vault-border overflow-hidden">
								<!-- Image preview -->
								{#if doc.isImage && doc.blobUrl}
									<div class="p-2 bg-vault-bg">
										<img
											src={doc.blobUrl}
											alt={doc.fileName}
											class="max-w-full max-h-80 rounded object-contain mx-auto"
										/>
									</div>
								{:else if doc.isImage && doc.loading}
									<div class="p-8 bg-vault-bg flex items-center justify-center">
										<div class="flex items-center gap-2 text-vault-text-muted">
											<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
											<span class="text-xs">Decrypting image…</span>
										</div>
									</div>
								{:else if doc.isImage && doc.error}
									<div class="p-8 bg-vault-bg flex items-center justify-center">
										<span class="text-xs text-vault-red">{doc.error}</span>
									</div>
								{/if}

								<!-- File info bar -->
								<div class="flex items-center justify-between px-3 py-2.5">
									<div class="flex items-center gap-2 min-w-0">
										<!-- File icon -->
										{#if doc.isImage}
											<svg class="w-4 h-4 text-vault-text-dim shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
											</svg>
										{:else}
											<svg class="w-4 h-4 text-vault-text-dim shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
											</svg>
										{/if}
										<div class="min-w-0">
											<p class="text-sm text-vault-text font-mono truncate">{doc.fileName}</p>
											<p class="text-[10px] text-vault-text-dim">{formatFileSize(doc.fileSize)}</p>
										</div>
									</div>

									<!-- Download button -->
									<button
										onclick={() => handleDownload(doc)}
										disabled={doc.loading}
										class="shrink-0 ml-3 p-1.5 rounded text-vault-text-muted hover:text-vault-text hover:bg-vault-bg transition-colors disabled:opacity-30"
										title="Download file"
									>
										{#if doc.loading}
											<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
										{:else}
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
											</svg>
										{/if}
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Reply area -->
	<div class="sticky bottom-0 bg-vault-bg border-t border-vault-border-subtle py-4 space-y-3">
		{#if error}
			<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-red-muted border border-vault-red/30">
				<svg class="w-4 h-4 text-vault-red shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span class="text-sm text-vault-red">{error}</span>
			</div>
		{/if}

		<!-- File attachments bar -->
		{#if files && files.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each Array.from(files) as file}
					<div class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-vault-surface border border-vault-border text-xs font-mono text-vault-text-muted">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
						</svg>
						{file.name}
					</div>
				{/each}
			</div>
		{/if}

		<form onsubmit={(e) => { e.preventDefault(); handleSend(); }} autocomplete="off" class="flex items-end gap-2">
			<!-- File upload button -->
			<label
				for="thread-files"
				class="shrink-0 p-2.5 rounded-lg border border-vault-border hover:border-vault-text-dim text-vault-text-muted hover:text-vault-text transition-colors cursor-pointer"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
				</svg>
				<input
					id="thread-files"
					type="file"
					multiple
					onchange={handleFileChange}
					class="hidden"
				/>
			</label>

			<!-- Text input -->
			<textarea
				bind:value={replyText}
				placeholder="Type your reply…"
				autocomplete="off"
				rows={1}
				class="flex-1 bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-none max-h-32"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						handleSend();
					}
				}}
			></textarea>

			<!-- Send button -->
			<button
				type="submit"
				disabled={sending || !replyText.trim()}
				class="shrink-0 p-2.5 rounded-lg bg-vault-green hover:bg-vault-green-dim text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
			>
				{#if sending}
					<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else}
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
					</svg>
				{/if}
			</button>
		</form>
	</div>
</div>
