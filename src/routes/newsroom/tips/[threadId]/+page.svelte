<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import {
		unsealThreadKey,
		decryptMessage,
		encryptMessage,
		decryptFile,
		sealThreadKeyForJournalist,
		fromBase64,
		toBase64
	} from '$lib/crypto';
	import { ApiError, api } from '$lib/api';
	import type { ProvenanceEntry } from '$lib/api';
	import { getToken } from '$lib/newsroom/auth';
	import { createWsConnection, newsroomWsUrl } from '$lib/ws';
	import type { NewsroomMessage, TipStatus, TeamMember, ThreadNote, DocumentMeta } from '$lib/newsroom/types';
	import MessageBubble from '../../../components/newsroom/MessageBubble.svelte';
	import StatusPill from '../../../components/newsroom/StatusPill.svelte';

	const threadId = $derived($page.params.threadId ?? '');
	const shortId = $derived(threadId.slice(0, 12));
	const user = $derived($newsroomAuth.user);
	const isEditor = $derived(user?.role === 'editor');
	const privateKey = $derived($newsroomAuth.privateKey);
	const publicKey = $derived($newsroomAuth.publicKey);

	let messages: NewsroomMessage[] = $state([]);
	let decryptedTexts: Map<string, string> = $state(new Map());
	let threadKey: Uint8Array | null = $state(null);
	let canDecrypt = $state(false);
	let decryptError = $state('');
	let tipStatus: TipStatus = $state('new');
	let assignedTo: string | null = $state(null);
	let assigneeName: string | null = $state(null);
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let updateError = $state('');

	// Reply state
	let replyText = $state('');
	let sendingReply = $state(false);
	let replyError = $state('');

	// Modal state: assign to reporter
	let showAssignModal = $state(false);
	let teamMembers: TeamMember[] = $state([]);
	let loadingTeam = $state(false);
	let assigningMemberId: string | null = $state(null);

	// Modal state: create investigation
	let showInvestigationModal = $state(false);
	let investigationCodename = $state('');
	let creatingInvestigation = $state(false);

	// Notes state
	let notes: ThreadNote[] = $state([]);
	let showNotes = $state(false);
	let newNoteText = $state('');
	let savingNote = $state(false);

	// Documents state
	interface DecryptedDoc {
		id: string;
		fileName: string;
		fileSize: number;
		blobUrl: string | null;
		previewUrl: string | null;
		isImage: boolean;
		mimeType: string;
		createdAt: string;
		loading: boolean;
	}

	const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
	function getExtension(name: string): string {
		const parts = name.split('.');
		return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
	}
	function getMimeType(name: string): string {
		const ext = getExtension(name);
		const map: Record<string, string> = {
			png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
			gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
			bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain',
		};
		return map[ext] ?? 'application/octet-stream';
	}

	let threadDocuments: DocumentMeta[] = $state([]);
	let decryptedDocs: Map<string, DecryptedDoc> = $state(new Map());

	// Export state
	let showExportModal = $state(false);
	let exportFormat: 'text' | 'json' = $state('text');
	let exportIncludeProvenance = $state(true);
	let exporting = $state(false);
	let exportError = $state('');

	// Scroll anchor for auto-scrolling to latest message
	let scrollAnchor: HTMLDivElement | undefined = $state();

	const isAssignedToMe = $derived(assignedTo && user && assignedTo === user.journalist_id);

	function scrollToBottom() {
		if (!scrollAnchor) return;
		requestAnimationFrame(() => {
			scrollAnchor?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	function prevSenderRole(index: number): 'source' | 'journalist' | null {
		if (index === 0) return null;
		return messages[index - 1]?.sender_role ?? null;
	}

	function senderLabel(msg: NewsroomMessage): string {
		if (msg.sender_role === 'source') return 'Sender';
		return user?.display_name ?? 'Responder';
	}

	function initials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	const statuses: TipStatus[] = ['new', 'review', 'active', 'closed'];

	async function loadNotes() {
		try {
			const res = await newsroomApi.getNotes(threadId);
			notes = res.notes ?? [];
		} catch {
			// Non-critical
		}
	}

	async function handleSaveNote() {
		if (!newNoteText.trim() || !threadKey) return;
		savingNote = true;
		try {
			const encrypted = await encryptMessage(newNoteText.trim(), threadKey);
			await newsroomApi.createNote(threadId, {
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce)
			});
			newNoteText = '';
			await loadNotes();
		} catch {
			// Silently fail
		} finally {
			savingNote = false;
		}
	}

	async function handleDeleteNote(noteId: string) {
		try {
			await newsroomApi.deleteNote(threadId, noteId);
			notes = notes.filter((n) => n.id !== noteId);
		} catch {
			// Silently fail
		}
	}

	async function decryptNoteText(note: ThreadNote): Promise<string> {
		if (!threadKey) return '[encrypted]';
		try {
			return await decryptMessage(fromBase64(note.ciphertext), fromBase64(note.nonce), threadKey);
		} catch {
			return '[decryption failed]';
		}
	}

	let decryptedNotes: Map<string, string> = $state(new Map());

	async function decryptAllNotes() {
		if (!threadKey) return;
		const newMap = new Map<string, string>();
		for (const note of notes) {
			newMap.set(note.id, await decryptNoteText(note));
		}
		decryptedNotes = newMap;
	}

	async function loadDocuments() {
		try {
			const res = await newsroomApi.getDocuments(threadId);
			threadDocuments = res.documents ?? [];
		} catch {
			// Non-critical
		}
	}

	async function decryptAllDocuments() {
		if (!threadKey) return;
		const newMap = new Map<string, DecryptedDoc>();
		for (const doc of threadDocuments) {
			try {
				// Decrypt filename if available
				let fileName = `document-${doc.id.slice(0, 8)}`;
				if (doc.encrypted_name && doc.name_nonce) {
					try {
						const nameBytes = await decryptFile(
							fromBase64(doc.encrypted_name),
							fromBase64(doc.name_nonce),
							threadKey
						);
						fileName = new TextDecoder().decode(nameBytes);
					} catch { /* use default name */ }
				}

				const ext = getExtension(fileName);
				const isImage = IMAGE_EXTENSIONS.has(ext);
				const mimeType = getMimeType(fileName);

				const entry: DecryptedDoc = {
					id: doc.id,
					fileName,
					fileSize: doc.file_size,
					blobUrl: null,
					previewUrl: null,
					isImage,
					mimeType,
					createdAt: doc.created_at,
					loading: isImage // images will auto-decrypt for preview
				};
				newMap.set(doc.id, entry);
			} catch {
				// skip unreadable docs
			}
		}
		decryptedDocs = newMap;

		// Auto-decrypt images for inline preview
		for (const [docId, doc] of newMap) {
			if (doc.isImage) {
				fetchAndDecryptDocument(docId).catch(() => {});
			}
		}
	}

	async function fetchAndDecryptDocument(docId: string): Promise<void> {
		if (!threadKey) return;
		const doc = decryptedDocs.get(docId);
		if (!doc) return;

		try {
			const res = await fetch(`/api/documents/${docId}`, {
				headers: { Authorization: `Bearer ${getToken()}` }
			});
			if (!res.ok) throw new Error('Failed to fetch document');
			const data = await res.json();
			const plaintext = await decryptFile(
				fromBase64(data.ciphertext),
				fromBase64(data.nonce),
				threadKey
			);
			const blob = new Blob([plaintext], { type: doc.mimeType });
			const url = URL.createObjectURL(blob);
			doc.blobUrl = url;
			doc.previewUrl = url;
			doc.loading = false;
			// Trigger reactivity
			decryptedDocs = new Map(decryptedDocs);
		} catch {
			doc.loading = false;
			decryptedDocs = new Map(decryptedDocs);
		}
	}

	async function handleDownloadDocument(docId: string) {
		if (!threadKey) return;
		const doc = decryptedDocs.get(docId);
		if (!doc) return;

		try {
			let url = doc.blobUrl;

			// If we already have the decrypted blob, use it directly
			if (!url) {
				const res = await fetch(`/api/documents/${docId}`, {
					headers: { Authorization: `Bearer ${getToken()}` }
				});
				if (!res.ok) throw new Error('Failed to fetch document');
				const data = await res.json();
				const plaintext = await decryptFile(
					fromBase64(data.ciphertext),
					fromBase64(data.nonce),
					threadKey
				);
				const blob = new Blob([plaintext], { type: doc.mimeType });
				url = URL.createObjectURL(blob);
				doc.blobUrl = url;
				doc.previewUrl = url;
				decryptedDocs = new Map(decryptedDocs);
			}

			const a = document.createElement('a');
			a.href = url;
			a.download = doc.fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		} catch (err) {
			console.warn('Failed to download document:', err);
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadThread() {
		loading = true;
		error = '';
		decryptError = '';
		try {
			const res = await newsroomApi.getMessages(threadId);
			messages = res.messages ?? [];

			// Load tip metadata from tips list to get current status/assignment
			try {
				const tipsRes = await newsroomApi.getTips();
				const tip = tipsRes.tips?.find((t) => t.id === threadId);
				if (tip) {
					tipStatus = tip.status;
					assignedTo = tip.assigned_to;
					assigneeName = tip.assignee_name;
				}
			} catch {
				// Non-critical — status controls just won't have initial data
			}

			// Mark thread as read
			newsroomApi.markRead(threadId).catch(() => {});

			// Attempt to unseal the thread key and decrypt messages
			await attemptDecryption();

			// Load internal notes
			await loadNotes();
			await decryptAllNotes();

			// Load documents
			await loadDocuments();
			await decryptAllDocuments();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load thread.';
		} finally {
			loading = false;
			scrollToBottom();
		}
	}

	async function attemptDecryption() {
		if (!privateKey || !publicKey) {
			decryptError = 'No decryption keys available — keypair not loaded';
			canDecrypt = false;
			return;
		}

		try {
			const sealedRes = await newsroomApi.getSealedKey(threadId);
			const sealed = fromBase64(sealedRes.sealed_key);
			threadKey = await unsealThreadKey(sealed, publicKey, privateKey);
			canDecrypt = true;
			await decryptAllMessages();
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				decryptError = 'No decryption key for this thread';
			} else {
				decryptError = 'Failed to decrypt thread key';
				console.warn('Decryption error:', err);
			}
			canDecrypt = false;
			threadKey = null;
		}
	}

	async function decryptAllMessages() {
		if (!threadKey) return;

		const newMap = new Map<string, string>();
		for (const msg of messages) {
			try {
				const text = await decryptMessage(
					fromBase64(msg.ciphertext),
					fromBase64(msg.nonce),
					threadKey
				);
				newMap.set(msg.id, text);
			} catch {
				console.warn(`Failed to decrypt message ${msg.id}`);
			}
		}
		decryptedTexts = newMap;
	}

	// ── Status change (uses new workflow endpoint) ────────────

	async function handleStatusChange(newStatus: TipStatus) {
		if (newStatus === tipStatus) return;
		updating = true;
		updateError = '';
		try {
			const res = await newsroomApi.updateThreadStatus(threadId, newStatus);
			tipStatus = res.status as TipStatus;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to update status.';
		} finally {
			updating = false;
		}
	}

	// ── Assignment (uses new workflow endpoints) ──────────────

	async function handleAssignToMe() {
		if (!user) return;
		updating = true;
		updateError = '';
		try {
			// Self-grant key if editor with thread key and no existing grant
			if (isEditor && threadKey && publicKey) {
				try {
					await newsroomApi.getSealedKey(threadId);
				} catch (err) {
					if (err instanceof ApiError && err.status === 404) {
						const sealed = await sealThreadKeyForJournalist(threadKey, publicKey);
						await newsroomApi.grantKey(threadId, {
							journalist_id: user.journalist_id,
							sealed_key: toBase64(sealed)
						});
					}
				}
			}

			await newsroomApi.assignThread(threadId, user.journalist_id);
			assignedTo = user.journalist_id;
			assigneeName = user.display_name;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to assign.';
		} finally {
			updating = false;
		}
	}

	async function handleUnassign() {
		updating = true;
		updateError = '';
		try {
			await newsroomApi.unassignThread(threadId);
			assignedTo = null;
			assigneeName = null;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to unassign.';
		} finally {
			updating = false;
		}
	}

	async function openAssignModal() {
		showAssignModal = true;
		loadingTeam = true;
		try {
			const res = await newsroomApi.getTeamMembers();
			// Exclude current user from the list
			teamMembers = (res.members ?? []).filter((m) => m.id !== user?.journalist_id);
		} catch {
			teamMembers = [];
		} finally {
			loadingTeam = false;
		}
	}

	async function handleAssignToMember(member: TeamMember) {
		if (!threadKey) return;
		assigningMemberId = member.id;
		updateError = '';
		try {
			// Fetch the member's public key and seal thread key
			const pubkeysRes = await newsroomApi.getReporterPublicKeys();
			// Also check editor keys — the member might be an editor
			const editorKeysRes = await newsroomApi.getEditorPublicKeys();
			const allKeys = [...pubkeysRes.keys, ...editorKeysRes.keys];
			const targetKey = allKeys.find((k) => k.journalist_id === member.id);

			if (!targetKey) {
				updateError = `${member.display_name} has no public key on file.`;
				assigningMemberId = null;
				return;
			}

			const recipientPubKey = fromBase64(targetKey.public_key);
			const sealed = await sealThreadKeyForJournalist(threadKey, recipientPubKey);

			// Grant key, then assign
			await newsroomApi.grantKey(threadId, {
				journalist_id: member.id,
				sealed_key: toBase64(sealed)
			});
			await newsroomApi.assignThread(threadId, member.id);
			assignedTo = member.id;
			assigneeName = member.display_name;
			showAssignModal = false;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to assign.';
		} finally {
			assigningMemberId = null;
		}
	}

	// ── Investigation (replaces prompt() with modal) ─────────

	function openInvestigationModal() {
		investigationCodename = '';
		showInvestigationModal = true;
	}

	async function handleCreateInvestigation() {
		if (!investigationCodename.trim()) return;
		creatingInvestigation = true;
		updateError = '';
		try {
			const inv = await newsroomApi.createInvestigation({
				thread_id: threadId,
				codename: investigationCodename.trim()
			});
			showInvestigationModal = false;
			goto(`/newsroom/investigations/${inv.id}`);
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to create investigation.';
			creatingInvestigation = false;
		}
	}

	// ── Export for publication ────────────────────────────────

	function openExportModal() {
		exportFormat = 'text';
		exportIncludeProvenance = true;
		exportError = '';
		showExportModal = true;
	}

	async function handleExport() {
		if (!canDecrypt || decryptedTexts.size === 0) return;
		exporting = true;
		exportError = '';

		try {
			// Collect provenance chain if requested
			let provenance: ProvenanceEntry[] = [];
			if (exportIncludeProvenance) {
				try {
					const provRes = await api.getProvenance(threadId);
					provenance = provRes.entries ?? [];
				} catch {
					// Non-critical — export without provenance
				}
			}

			const exportData = buildExportData(provenance);
			let content: string;
			let filename: string;
			let mimeType: string;

			if (exportFormat === 'json') {
				content = JSON.stringify(exportData, null, 2);
				filename = `scrivault-thread-${shortId}-export.json`;
				mimeType = 'application/json';
			} else {
				content = buildPlainTextExport(exportData);
				filename = `scrivault-thread-${shortId}-export.txt`;
				mimeType = 'text/plain';
			}

			// Trigger download
			const blob = new Blob([content], { type: mimeType });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			showExportModal = false;
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Export failed.';
		} finally {
			exporting = false;
		}
	}

	interface ExportMessage {
		sender: string;
		timestamp: string;
		content: string;
	}

	interface ExportData {
		thread_id: string;
		exported_at: string;
		exported_by: string;
		status: TipStatus;
		assigned_to: string | null;
		message_count: number;
		messages: ExportMessage[];
		provenance?: ProvenanceEntry[];
	}

	function buildExportData(provenance: ProvenanceEntry[]): ExportData {
		const exportMessages: ExportMessage[] = messages.map((msg) => ({
			sender: msg.sender_role === 'source' ? 'Sender' : (user?.display_name ?? 'Responder'),
			timestamp: msg.created_at,
			content: decryptedTexts.get(msg.id) ?? '[unable to decrypt]'
		}));

		const data: ExportData = {
			thread_id: threadId,
			exported_at: new Date().toISOString(),
			exported_by: user?.display_name ?? 'Unknown',
			status: tipStatus,
			assigned_to: assigneeName,
			message_count: exportMessages.length,
			messages: exportMessages
		};

		if (provenance.length > 0) {
			data.provenance = provenance;
		}

		return data;
	}

	function buildPlainTextExport(data: ExportData): string {
		const lines: string[] = [];
		const divider = '─'.repeat(60);

		lines.push('SCRIVAULT — THREAD EXPORT');
		lines.push(divider);
		lines.push(`Thread ID:    ${data.thread_id}`);
		lines.push(`Status:       ${data.status}`);
		if (data.assigned_to) {
			lines.push(`Assigned to:  ${data.assigned_to}`);
		}
		lines.push(`Exported by:  ${data.exported_by}`);
		lines.push(`Exported at:  ${formatTimestamp(data.exported_at)}`);
		lines.push(`Messages:     ${data.message_count}`);
		lines.push(divider);
		lines.push('');

		lines.push('MESSAGES');
		lines.push(divider);

		for (const msg of data.messages) {
			lines.push(`[${formatTimestamp(msg.timestamp)}] ${msg.sender}:`);
			lines.push(msg.content);
			lines.push('');
		}

		if (data.provenance && data.provenance.length > 0) {
			lines.push(divider);
			lines.push('PROVENANCE CHAIN');
			lines.push(divider);
			lines.push('');

			for (const entry of data.provenance) {
				lines.push(`#${entry.sequence_num}  ${entry.event_type}`);
				lines.push(`  Time: ${formatTimestamp(entry.created_at)}`);
				lines.push(`  Hash: ${entry.entry_hash}`);
				lines.push(`  Prev: ${entry.prev_hash}`);
				lines.push('');
			}
		}

		lines.push(divider);
		lines.push('End of export');
		lines.push('');
		lines.push('This export was generated from an end-to-end encrypted conversation.');
		lines.push('Provenance hashes provide a tamper-evident chain of custody.');

		return lines.join('\n');
	}

	function formatTimestamp(iso: string): string {
		try {
			return new Date(iso).toLocaleString('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false
			});
		} catch {
			return iso;
		}
	}

	async function refreshMessages() {
		try {
			const res = await newsroomApi.getMessages(threadId);
			messages = res.messages ?? [];
			await decryptAllMessages();
			scrollToBottom();
		} catch {
			// Non-critical — will retry on next notification
		}
	}

	async function handleSendReply() {
		if (!replyText.trim() || !threadKey) return;

		sendingReply = true;
		replyError = '';
		try {
			const encrypted = await encryptMessage(replyText.trim(), threadKey);
			await newsroomApi.sendMessage(threadId, {
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce)
			});

			replyText = '';
			await refreshMessages();
		} catch (err) {
			replyError = err instanceof Error ? err.message : 'Failed to send reply.';
		} finally {
			sendingReply = false;
		}
	}

	// Load thread on mount
	$effect(() => {
		if (threadId) loadThread();
	});

	// WebSocket for real-time message notifications
	$effect(() => {
		if (!threadId) return;
		const token = getToken();
		if (!token) return;

		const destroyWs = createWsConnection({
			url: newsroomWsUrl(threadId, token),
			onMessage(notification) {
				if (notification.type === 'new_message') {
					refreshMessages();
				}
				if (notification.type === 'new_document') {
					loadDocuments().then(() => decryptAllDocuments());
				}
			}
		});

		return () => {
			destroyWs();
		};
	});
</script>

<svelte:head>
	<title>Report {shortId}… — Scrivault</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between pl-14 pr-6 md:px-6 py-3 border-b border-vault-border bg-vault-surface shrink-0"
>
	<div class="flex items-center gap-3">
		<a
			href="/newsroom/tips"
			aria-label="Back to reports"
			class="text-vault-text-muted hover:text-vault-text transition-colors"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M15 19l-7-7 7-7"
				/>
			</svg>
		</a>
		<div>
			<h2 class="text-sm font-medium text-vault-text">Report</h2>
			<span class="font-mono text-[11px] text-vault-text-dim">{shortId}…</span>
		</div>
	</div>
	<div class="flex items-center gap-2">
		{#if canDecrypt}
			<div class="inline-flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div><span class="text-[10px] text-vault-green">Decrypted</span></div>
		{:else if !loading && !error}
			<div class="inline-flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div><span class="text-[10px] text-vault-amber">Encrypted</span></div>
		{/if}
		<StatusPill status={tipStatus} />
	</div>
</div>

{#if loading}
	<div class="flex-1 flex items-center justify-center">
		<div class="flex items-center gap-3 text-vault-text-muted">
			<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
			</svg>
			<span class="text-sm">Loading report…</span>
		</div>
	</div>
{:else if error}
	<div class="flex-1 flex items-center justify-center">
		<div class="text-center">
			<p class="text-sm text-vault-red mb-4">{error}</p>
			<button
				onclick={loadThread}
				class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
			>
				Try again
			</button>
		</div>
	</div>
{:else}
	<!-- Controls bar -->
	<div class="px-6 py-2.5 border-b border-vault-border bg-vault-surface/50 shrink-0">
		<div class="flex items-center gap-3 flex-wrap">
			<!-- Status selector -->
			<div class="flex items-center gap-1.5">
				{#each statuses as s}
					<button
						onclick={() => handleStatusChange(s)}
						disabled={updating}
						class="px-1.5 py-0.5 rounded text-[10px] transition-colors
							{tipStatus === s
							? 'bg-vault-surface-raised text-vault-text border border-vault-border'
							: 'text-vault-text-dim hover:text-vault-text-muted'}"
					>
						{s}
					</button>
				{/each}
			</div>

			<div class="w-px h-4 bg-vault-border"></div>

			<!-- Assignment display + actions -->
			{#if assignedTo}
				<div class="flex items-center gap-2">
					<div class="flex items-center gap-1.5">
						<div class="w-4 h-4 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center">
							<span class="text-[7px] text-vault-text-dim">
								{initials(assigneeName ?? '??')}
							</span>
						</div>
						<span class="text-[10px] text-vault-text-muted">
							{isAssignedToMe ? 'Assigned to you' : `Assigned to ${assigneeName ?? 'Unknown'}`}
						</span>
					</div>
					{#if isEditor}
						<button
							onclick={handleUnassign}
							disabled={updating}
							class="text-[10px] text-vault-text-dim hover:text-vault-red transition-colors disabled:opacity-30"
						>
							Unassign
						</button>
					{/if}
				</div>
			{/if}

			{#if !assignedTo || isEditor}
				{#if !isAssignedToMe}
					<button
						onclick={handleAssignToMe}
						disabled={updating}
						class="text-[10px] text-vault-text-dim hover:text-vault-text transition-colors disabled:opacity-30"
					>
						Assign to me
					</button>
				{/if}
			{/if}

			{#if isEditor && canDecrypt}
				<button
					onclick={openAssignModal}
					disabled={updating}
					class="text-[10px] text-vault-text-dim hover:text-vault-text transition-colors disabled:opacity-30"
				>
					Assign to team member
				</button>
			{/if}

			<!-- Export + Promote — right side -->
		<div class="ml-auto flex items-center gap-2">
			{#if canDecrypt && decryptedTexts.size > 0}
				<button
					onclick={openExportModal}
					class="px-2.5 py-1 rounded text-[10px] text-vault-text-dim hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors"
				>
					<span class="inline-flex items-center gap-1">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
						Export
					</span>
				</button>
			{/if}
			{#if isEditor}
				<button
					onclick={openInvestigationModal}
					disabled={updating}
					class="px-2.5 py-1 rounded text-[10px] text-vault-green hover:text-vault-green-dim bg-vault-green-muted border border-vault-green/20 transition-colors disabled:opacity-30"
				>
					Create Investigation
				</button>
			{/if}
		</div>
		</div>

		{#if updateError}
			<p class="text-[10px] text-vault-red mt-1.5">{updateError}</p>
		{/if}
	</div>

	<!-- Decryption status notice -->
	{#if decryptError}
		<div class="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-amber/10 border border-vault-amber/20 shrink-0">
			<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60 shrink-0"></div>
			<span class="text-[11px] text-vault-amber">{decryptError}</span>
		</div>
	{/if}

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto px-6 py-6">
		{#if messages.length === 0}
			<div class="flex items-center justify-center py-12 text-sm text-vault-text-dim">
				No messages yet.
			</div>
		{:else}
			{#each messages as msg, i (msg.id)}
				{@const sameSender = i > 0 && prevSenderRole(i) === msg.sender_role}
				<div class="{i === 0 ? '' : sameSender ? 'mt-1' : 'mt-4'}">
					<MessageBubble
						message={msg}
						decryptedText={decryptedTexts.get(msg.id)}
						senderLabel={senderLabel(msg)}
						{sameSender}
					/>
				</div>
			{/each}
		{/if}
		<!-- Documents section -->
		{#if decryptedDocs.size > 0}
			<div class="mt-6 pt-4 border-t border-vault-border/50">
				<p class="text-[10px] font-medium tracking-wide text-zinc-500 mb-3">
					Attached Files ({decryptedDocs.size})
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{#each [...decryptedDocs.values()] as doc (doc.id)}
						<div class="rounded-lg bg-vault-surface border border-vault-border overflow-hidden group hover:border-vault-green/30 transition-colors">
							<!-- Image preview -->
							{#if doc.isImage && doc.previewUrl}
								<button
									onclick={() => handleDownloadDocument(doc.id)}
									class="w-full bg-vault-bg p-2 cursor-pointer"
									title="Click to download"
								>
									<img
										src={doc.previewUrl}
										alt={doc.fileName}
										class="max-w-full max-h-48 rounded object-contain mx-auto"
									/>
								</button>
							{:else if doc.isImage && doc.loading}
								<div class="w-full bg-vault-bg p-6 flex items-center justify-center">
									<div class="flex items-center gap-2 text-vault-text-muted">
										<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
										<span class="text-xs">Decrypting image…</span>
									</div>
								</div>
							{/if}

							<!-- File info bar -->
							<button
								onclick={() => handleDownloadDocument(doc.id)}
								class="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
								title="Download {doc.fileName}"
							>
								<div class="w-8 h-8 rounded bg-vault-surface-raised border border-vault-border flex items-center justify-center shrink-0">
									{#if doc.isImage}
										<svg class="w-4 h-4 text-vault-text-dim group-hover:text-vault-green transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
										</svg>
									{:else}
										<svg class="w-4 h-4 text-vault-text-dim group-hover:text-vault-green transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
										</svg>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="text-xs text-vault-text truncate">{doc.fileName}</p>
									<p class="text-[10px] text-vault-text-dim">{formatFileSize(doc.fileSize)}</p>
								</div>
								<svg class="w-4 h-4 text-vault-text-dim group-hover:text-vault-green transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<div bind:this={scrollAnchor}></div>
	</div>

	<!-- Internal Notes toggle -->
	{#if canDecrypt}
		<div class="shrink-0 border-t border-vault-border">
			<button
				onclick={() => { showNotes = !showNotes; }}
				class="w-full flex items-center justify-between px-6 py-2 text-left hover:bg-vault-surface-raised/50 transition-colors"
			>
				<span class="text-[10px] tracking-wide font-medium text-vault-text-dim">
					Internal Notes {notes.length > 0 ? `(${notes.length})` : ''}
				</span>
				<svg class="w-3 h-3 text-vault-text-dim transition-transform {showNotes ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{#if showNotes}
				<div class="px-6 pb-3 space-y-2 max-h-48 overflow-y-auto">
					{#each notes as note (note.id)}
						<div class="flex items-start gap-2 px-3 py-2 rounded bg-vault-surface-raised border border-vault-border">
							<p class="flex-1 text-xs text-vault-text whitespace-pre-wrap">{decryptedNotes.get(note.id) ?? '[encrypted]'}</p>
							{#if note.journalist_id === user?.journalist_id}
								<button
									onclick={() => handleDeleteNote(note.id)}
									class="shrink-0 text-[10px] text-vault-text-dim hover:text-vault-red transition-colors"
									title="Delete note"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							{/if}
						</div>
					{/each}
					{#if notes.length === 0}
						<p class="text-[11px] text-vault-text-dim py-1">No notes yet.</p>
					{/if}
					<form
						onsubmit={(e) => { e.preventDefault(); handleSaveNote(); }}
						class="flex gap-2 mt-1"
					>
						<input
							type="text"
							bind:value={newNoteText}
							placeholder="Add an internal note…"
							disabled={savingNote}
							class="flex-1 bg-vault-bg border border-vault-border rounded px-2.5 py-1.5 text-xs text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors disabled:opacity-50"
						/>
						<button
							type="submit"
							disabled={!newNoteText.trim() || savingNote}
							class="px-2.5 py-1.5 rounded text-[10px] bg-vault-surface-raised border border-vault-border text-vault-text-muted hover:text-vault-text transition-colors disabled:opacity-30"
						>
							{savingNote ? '…' : 'Add'}
						</button>
					</form>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Reply area — sticky on mobile so it's always accessible -->
	<div class="shrink-0 sticky bottom-0 z-10 px-6 py-3 border-t border-vault-border bg-vault-surface/95 backdrop-blur-sm">
		{#if canDecrypt}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSendReply();
				}}
				class="flex items-end gap-2"
			>
				<textarea
					bind:value={replyText}
					rows={1}
					placeholder="Type your reply…"
					disabled={sendingReply}
					class="flex-1 bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-none max-h-32 disabled:opacity-50"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							handleSendReply();
						}
					}}
				></textarea>

				<button
					type="submit"
					disabled={!replyText.trim() || sendingReply}
					class="shrink-0 p-2.5 rounded-lg bg-vault-green hover:bg-vault-green-dim text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
				>
					{#if sendingReply}
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

			{#if replyError}
				<p class="text-[10px] text-vault-red mt-1.5">{replyError}</p>
			{/if}
		{:else}
			<div class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-vault-surface border border-vault-border">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
				<span class="text-[11px] text-vault-text-dim">
					{decryptError || 'No decryption key available — replies disabled'}
				</span>
			</div>
		{/if}
	</div>
{/if}

<!-- Assign to Reporter modal -->
{#if showAssignModal}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showAssignModal = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showAssignModal = false; }}
		role="dialog"
		aria-modal="true"
		aria-label="Assign to team member"
	>
		<div class="w-full max-w-sm mx-4 rounded-lg bg-vault-surface border border-vault-border shadow-2xl">
			<div class="px-4 py-3 border-b border-vault-border">
				<h3 class="text-xs text-vault-text">Assign to team member</h3>
			</div>
			<div class="max-h-64 overflow-y-auto">
				{#if loadingTeam}
					<div class="flex items-center justify-center py-8">
						<svg class="w-4 h-4 animate-spin text-vault-text-dim" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					</div>
				{:else if teamMembers.length === 0}
					<div class="px-4 py-6 text-center">
						<p class="text-sm text-vault-text-dim">No other team members found.</p>
					</div>
				{:else}
					{#each teamMembers as member (member.id)}
						<button
							onclick={() => handleAssignToMember(member)}
							disabled={assigningMemberId !== null}
							class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-vault-surface-raised disabled:opacity-50 border-b border-vault-border last:border-b-0"
						>
							<div class="w-7 h-7 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center shrink-0">
								<span class="text-[9px] text-vault-text-dim">
									{initials(member.display_name)}
								</span>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-sm text-vault-text truncate">{member.display_name}</p>
								<p class="text-[10px] text-vault-text-dim capitalize">{member.role}</p>
							</div>
							{#if assigningMemberId === member.id}
								<svg class="w-4 h-4 animate-spin text-vault-green shrink-0" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
			<div class="px-4 py-3 border-t border-vault-border">
				<button
					onclick={() => { showAssignModal = false; }}
					class="w-full px-3 py-2 rounded text-[11px] text-vault-text-muted hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Create Investigation modal -->
{#if showInvestigationModal}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showInvestigationModal = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showInvestigationModal = false; }}
		role="dialog"
		aria-modal="true"
		aria-label="Create investigation"
	>
		<div class="w-full max-w-sm mx-4 rounded-lg bg-vault-surface border border-vault-border shadow-2xl">
			<div class="px-4 py-3 border-b border-vault-border">
				<h3 class="text-xs text-vault-text">Create Investigation</h3>
			</div>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleCreateInvestigation();
				}}
				class="p-4 space-y-4"
			>
				<div>
					<label
						for="investigation-codename"
						class="block text-[10px] tracking-wide font-medium text-vault-text-dim mb-1.5"
					>
						Codename
					</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="investigation-codename"
						type="text"
						bind:value={investigationCodename}
						autofocus
						placeholder="e.g. NIGHTFALL"
						class="w-full bg-vault-bg border border-vault-border rounded-lg px-3 py-2.5 font-mono text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					/>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => { showInvestigationModal = false; }}
						class="flex-1 px-3 py-2 rounded text-[11px] text-vault-text-muted bg-vault-surface-raised border border-vault-border hover:text-vault-text transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!investigationCodename.trim() || creatingInvestigation}
						class="flex-1 px-3 py-2 rounded text-[11px] text-black bg-vault-green hover:bg-vault-green-dim border border-vault-green/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{creatingInvestigation ? 'Creating…' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Export modal -->
{#if showExportModal}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showExportModal = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showExportModal = false; }}
		role="dialog"
		aria-modal="true"
		aria-label="Export thread"
	>
		<div class="w-full max-w-sm mx-4 rounded-lg bg-vault-surface border border-vault-border shadow-2xl">
			<div class="px-4 py-3 border-b border-vault-border">
				<h3 class="text-xs text-vault-text">Export for Publication</h3>
			</div>
			<div class="p-4 space-y-4">
				<p class="text-xs text-vault-text-muted">
					Export decrypted thread content for publication review or legal proceedings.
				</p>

				<!-- Format selection -->
				<div>
					<span class="block text-[10px] tracking-wide font-medium text-vault-text-dim mb-2">
						Format
					</span>
					<div class="flex gap-2">
						<button
							onclick={() => { exportFormat = 'text'; }}
							class="flex-1 px-3 py-2 rounded text-xs transition-colors
								{exportFormat === 'text'
								? 'bg-vault-surface-raised text-vault-text border border-vault-green/40'
								: 'bg-vault-bg text-vault-text-dim border border-vault-border hover:text-vault-text-muted'}"
						>
							Plain Text
						</button>
						<button
							onclick={() => { exportFormat = 'json'; }}
							class="flex-1 px-3 py-2 rounded text-xs transition-colors
								{exportFormat === 'json'
								? 'bg-vault-surface-raised text-vault-text border border-vault-green/40'
								: 'bg-vault-bg text-vault-text-dim border border-vault-border hover:text-vault-text-muted'}"
						>
							JSON
						</button>
					</div>
				</div>

				<!-- Options -->
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={exportIncludeProvenance}
						class="w-3.5 h-3.5 rounded border-vault-border text-vault-green focus:ring-vault-green/50"
					/>
					<span class="text-xs text-vault-text-muted">Include provenance chain</span>
				</label>

				<!-- Summary -->
				<div class="px-3 py-2 rounded bg-vault-bg border border-vault-border-subtle">
					<div class="flex items-center justify-between text-[10px] text-vault-text-dim">
						<span>{decryptedTexts.size} messages</span>
						<span>{exportFormat === 'text' ? '.txt' : '.json'}</span>
					</div>
				</div>

				{#if exportError}
					<p class="text-[10px] text-vault-red">{exportError}</p>
				{/if}

				<!-- Actions -->
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => { showExportModal = false; }}
						class="flex-1 px-3 py-2 rounded text-[11px] text-vault-text-muted bg-vault-surface-raised border border-vault-border hover:text-vault-text transition-colors"
					>
						Cancel
					</button>
					<button
						onclick={handleExport}
						disabled={exporting}
						class="flex-1 px-3 py-2 rounded text-[11px] text-black bg-vault-green hover:bg-vault-green-dim border border-vault-green/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{#if exporting}
							Exporting…
						{:else}
							Download
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
