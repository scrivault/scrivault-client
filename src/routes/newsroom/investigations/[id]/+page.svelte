<script lang="ts">
	import { page } from '$app/stores';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import { encryptMessage, decryptMessage, toBase64, fromBase64, unsealThreadKey as unsealKey, derivePublicKey } from '$lib/crypto';
	import type {
		InvestigationDetailResponse,
		InvestigationNote,
		InvestigationStatus
	} from '$lib/newsroom/types';

	const invId = $derived(($page.params as Record<string, string>).id ?? '');
	const user = $derived($newsroomAuth.user);
	const isEditor = $derived(user?.role === 'editor');

	let investigation: InvestigationDetailResponse | null = $state(null);
	let loading = $state(true);
	let error = $state('');

	// Status workflow
	let updatingStatus = $state(false);

	// Summary
	let summaryText = $state('');
	let editingSummary = $state(false);
	let savingSummary = $state(false);

	// Notes
	let notes: InvestigationNote[] = $state([]);
	let decryptedNotes = $state(new Map<string, string>());
	let newNoteText = $state('');
	let savingNote = $state(false);
	let loadingNotes = $state(false);

	// Linked reports
	let showLinkForm = $state(false);
	let linkThreadId = $state('');
	let linkingReport = $state(false);
	let linkError = $state('');

	// Thread key (for encrypting notes/summary — we use the investigation's source thread key)
	let threadKey: Uint8Array | null = $state(null);

	const statusOptions: { value: InvestigationStatus; label: string; dot: string }[] = [
		{ value: 'active', label: 'Active', dot: 'bg-emerald-400' },
		{ value: 'on_hold', label: 'On Hold', dot: 'bg-amber-400' },
		{ value: 'published', label: 'Published', dot: 'bg-blue-400' },
		{ value: 'closed', label: 'Closed', dot: 'bg-zinc-500' }
	];

	async function loadInvestigation() {
		loading = true;
		error = '';
		try {
			investigation = await newsroomApi.getInvestigation(invId);
			// Try to unseal the thread key for note encryption
			await loadThreadKey();
			// Decrypt summary if available
			await decryptSummary();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load investigation.';
		} finally {
			loading = false;
		}
	}

	async function loadThreadKey() {
		if (!investigation) return;
		try {
			const keyRes = await newsroomApi.getSealedKey(investigation.thread_id);
			if (keyRes.sealed_key) {
				const privKey = $newsroomAuth.privateKey;
				if (privKey) {
					const pubKey = await derivePublicKey(privKey);
					threadKey = await unsealKey(fromBase64(keyRes.sealed_key), pubKey, privKey);
				}
			}
		} catch {
			// No thread key available — notes will be unavailable
		}
	}

	async function decryptSummary() {
		if (!investigation || !threadKey) return;
		if (!investigation.summary_ciphertext || !investigation.summary_nonce) return;
		try {
			summaryText = await decryptMessage(
				fromBase64(investigation.summary_ciphertext),
				fromBase64(investigation.summary_nonce),
				threadKey
			);
		} catch {
			summaryText = '[encrypted]';
		}
	}

	// Status
	async function handleStatusChange(newStatus: InvestigationStatus) {
		if (!investigation || !isEditor || updatingStatus) return;
		updatingStatus = true;
		try {
			const updated = await newsroomApi.updateInvestigation(invId, { status: newStatus });
			investigation = { ...investigation, status: updated.status };
		} catch (err) {
			console.error('Failed to update status:', err);
		} finally {
			updatingStatus = false;
		}
	}

	// Summary
	async function handleSaveSummary() {
		if (!investigation || !threadKey || savingSummary) return;
		savingSummary = true;
		try {
			const encrypted = await encryptMessage(summaryText, threadKey);
			await newsroomApi.updateInvestigation(invId, {
				summary_ciphertext: toBase64(encrypted.ciphertext),
				summary_nonce: toBase64(encrypted.nonce)
			});
			editingSummary = false;
		} catch (err) {
			console.error('Failed to save summary:', err);
		} finally {
			savingSummary = false;
		}
	}

	// Notes
	async function loadNotes() {
		loadingNotes = true;
		try {
			const res = await newsroomApi.getInvestigationNotes(invId);
			notes = res.notes ?? [];
		} catch (err) {
			console.error('Failed to load notes:', err);
		} finally {
			loadingNotes = false;
		}
	}

	async function decryptAllNotes() {
		if (!threadKey) return;
		const newMap = new Map<string, string>(decryptedNotes);
		for (const note of notes) {
			if (newMap.has(note.id)) continue;
			try {
				const text = await decryptMessage(
					fromBase64(note.ciphertext),
					fromBase64(note.nonce),
					threadKey
				);
				newMap.set(note.id, text);
			} catch {
				newMap.set(note.id, '[encrypted]');
			}
		}
		decryptedNotes = newMap;
	}

	async function handleSaveNote() {
		if (!newNoteText.trim() || !threadKey) return;
		const plaintext = newNoteText.trim();
		savingNote = true;
		try {
			const encrypted = await encryptMessage(plaintext, threadKey);
			const serverNote = await newsroomApi.createInvestigationNote(invId, {
				ciphertext: toBase64(encrypted.ciphertext),
				nonce: toBase64(encrypted.nonce)
			});
			// Optimistic display
			const realNote: InvestigationNote = {
				id: serverNote.id,
				investigation_id: invId,
				journalist_id: user?.journalist_id ?? '',
				author_name: user?.display_name ?? '',
				ciphertext: serverNote.ciphertext,
				nonce: serverNote.nonce,
				created_at: serverNote.created_at ?? new Date().toISOString()
			};
			notes = [...notes, realNote];
			decryptedNotes = new Map([...decryptedNotes, [serverNote.id, plaintext]]);
			newNoteText = '';
		} catch (err) {
			console.error('Failed to save note:', err);
		} finally {
			savingNote = false;
		}
	}

	async function handleDeleteNote(noteId: string) {
		try {
			await newsroomApi.deleteInvestigationNote(invId, noteId);
			notes = notes.filter((n) => n.id !== noteId);
			const updated = new Map(decryptedNotes);
			updated.delete(noteId);
			decryptedNotes = updated;
		} catch (err) {
			console.error('Failed to delete note:', err);
		}
	}

	// Link reports
	async function handleLinkReport() {
		if (!linkThreadId.trim()) return;
		linkingReport = true;
		linkError = '';
		try {
			await newsroomApi.linkReport(invId, { thread_id: linkThreadId.trim() });
			linkThreadId = '';
			showLinkForm = false;
			await loadInvestigation();
		} catch (err) {
			linkError = err instanceof Error ? err.message : 'Failed to link report.';
		} finally {
			linkingReport = false;
		}
	}

	async function handleUnlinkReport(threadId: string) {
		try {
			await newsroomApi.unlinkReport(invId, threadId);
			if (investigation) {
				investigation = {
					...investigation,
					reports: investigation.reports.filter((r) => r.thread_id !== threadId)
				};
			}
		} catch (err) {
			console.error('Failed to unlink report:', err);
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	$effect(() => {
		if (invId) {
			loadInvestigation();
			loadNotes();
		}
	});

	// Decrypt notes once thread key is available
	$effect(() => {
		if (threadKey && notes.length > 0) {
			decryptAllNotes();
		}
	});
</script>

<svelte:head>
	<title
		>{investigation ? investigation.codename : 'Investigation'} — Scrivault</title
	>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between pl-14 pr-6 md:px-6 py-4 border-b border-vault-border bg-vault-surface"
>
	<div class="flex items-center gap-3">
		<a
			href="/newsroom/investigations"
			aria-label="Back to investigations"
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
		<h2 class="text-sm font-medium text-vault-text">
			{investigation ? investigation.codename : 'Investigation'}
		</h2>
		{#if investigation}
			{@const sc = statusOptions.find((s) => s.value === investigation?.status) ?? statusOptions[0]}
			<span class="inline-flex items-center gap-1.5 ml-2">
				<span class="w-2 h-2 rounded-full {sc.dot}"></span>
				<span class="text-[11px] text-vault-text-muted">{sc.label}</span>
			</span>
		{/if}
	</div>
</div>

<!-- Content -->
<div class="flex-1 overflow-y-auto px-6 py-5">
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="flex items-center gap-3 text-vault-text-muted">
				<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				<span class="text-sm">Loading investigation…</span>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<p class="text-sm text-vault-red mb-4">{error}</p>
				<button
					onclick={loadInvestigation}
					class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
				>
					Try again
				</button>
			</div>
		</div>
	{:else if investigation}
		<!-- Investigation header -->
		<div class="p-5 rounded-lg bg-vault-surface border border-vault-border mb-6">
			<div class="flex items-start justify-between mb-1">
				<h3 class="text-xl font-medium text-vault-text">{investigation.codename}</h3>
				<!-- Status selector (editor-only) -->
				{#if isEditor}
					<select
						value={investigation.status}
						onchange={(e) => handleStatusChange((e.target as HTMLSelectElement).value as InvestigationStatus)}
						disabled={updatingStatus}
						class="text-[11px] bg-vault-bg border border-vault-border rounded px-2 py-1 text-vault-text focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors disabled:opacity-50"
					>
						{#each statusOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				{/if}
			</div>

			<!-- Summary -->
			<div class="mb-4">
				{#if editingSummary}
					<div class="mt-2">
						<textarea
							bind:value={summaryText}
							rows={3}
							class="w-full bg-vault-bg border border-vault-border rounded px-3 py-2 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-none"
							placeholder="Investigation summary…"
						></textarea>
						<div class="flex gap-2 mt-2">
							<button
								onclick={handleSaveSummary}
								disabled={savingSummary || !threadKey}
								class="px-3 py-1 rounded text-[11px] bg-white text-vault-bg font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
							>
								{savingSummary ? 'Saving…' : 'Save'}
							</button>
							<button
								onclick={() => { editingSummary = false; }}
								class="px-3 py-1 rounded text-[11px] text-vault-text-muted hover:text-vault-text transition-colors"
							>
								Cancel
							</button>
						</div>
					</div>
				{:else if summaryText && summaryText !== '[encrypted]'}
					<p class="text-sm text-vault-text-muted mt-1 whitespace-pre-wrap">{summaryText}</p>
					{#if isEditor && threadKey}
						<button
							onclick={() => { editingSummary = true; }}
							class="text-[10px] text-vault-text-dim hover:text-vault-text mt-1 transition-colors"
						>
							Edit summary
						</button>
					{/if}
				{:else}
					{#if isEditor && threadKey}
						<button
							onclick={() => { editingSummary = true; summaryText = ''; }}
							class="text-[11px] text-vault-text-dim hover:text-vault-text mt-1 transition-colors"
						>
							+ Add summary
						</button>
					{/if}
				{/if}
			</div>

			<div class="flex gap-6 flex-wrap">
				<div>
					<span class="block text-[10px] tracking-wide font-medium text-zinc-500">
						Created
					</span>
					<span class="text-[13px] text-vault-text-muted">
						{formatDate(investigation.created_at)}
					</span>
				</div>
				<div>
					<span class="block text-[10px] tracking-wide font-medium text-zinc-500">
						Team Size
					</span>
					<span class="text-[13px] text-vault-text-muted">
						{investigation.members.length} member{investigation.members.length !== 1 ? 's' : ''}
					</span>
				</div>
				<div>
					<span class="block text-[10px] tracking-wide font-medium text-zinc-500">
						Reports
					</span>
					<span class="text-[13px] text-vault-text-muted">
						{investigation.reports?.length ?? 0} linked
					</span>
				</div>
			</div>
		</div>

		<!-- Linked Reports -->
		<div class="mb-6">
			<div
				class="flex items-center justify-between text-[10px] tracking-wide font-medium text-zinc-500 mb-4 pb-2 border-b border-vault-border"
			>
				<span>Linked Reports</span>
				{#if isEditor}
					<button
						onclick={() => { showLinkForm = !showLinkForm; }}
						class="text-vault-text-muted hover:text-vault-text transition-colors"
					>
						{showLinkForm ? 'Cancel' : '+ Link Report'}
					</button>
				{/if}
			</div>

			{#if showLinkForm}
				<div class="mb-4 p-3 rounded-lg bg-vault-surface border border-vault-border">
					<form
						onsubmit={(e) => { e.preventDefault(); handleLinkReport(); }}
						class="space-y-2"
					>
						<label
							for="link-thread"
							class="block text-[10px] tracking-wide font-medium text-zinc-500"
						>
							Report Thread ID
						</label>
						<input
							id="link-thread"
							type="text"
							bind:value={linkThreadId}
							class="w-full bg-vault-bg border border-vault-border rounded px-3 py-2 text-sm font-mono text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
							placeholder="Paste thread UUID"
						/>
						{#if linkError}
							<p class="text-[11px] text-vault-red">{linkError}</p>
						{/if}
						<button
							type="submit"
							disabled={linkingReport || !linkThreadId.trim()}
							class="px-3 py-1.5 rounded text-[11px] bg-white text-vault-bg font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
						>
							{linkingReport ? 'Linking…' : 'Link'}
						</button>
					</form>
				</div>
			{/if}

			{#if investigation.reports && investigation.reports.length > 0}
				<div class="space-y-2">
					{#each investigation.reports as report}
						<div class="flex items-center justify-between p-3 rounded-lg bg-vault-surface border border-vault-border">
							<div class="flex items-center gap-3">
								<a
									href="/newsroom/tips/{report.thread_id}"
									class="font-mono text-[12px] text-vault-text hover:text-white transition-colors underline underline-offset-2"
								>
									{report.blinded_id.slice(0, 16)}…
								</a>
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-vault-bg text-vault-text-dim capitalize">
									{report.status}
								</span>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-[10px] text-vault-text-dim">
									Linked {formatDate(report.linked_at)}
								</span>
								{#if isEditor && investigation.reports.length > 1}
									<button
										onclick={() => handleUnlinkReport(report.thread_id)}
										class="text-[10px] text-vault-red/70 hover:text-vault-red transition-colors"
									>
										Unlink
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-vault-text-dim">No linked reports.</p>
			{/if}
		</div>

		<!-- Members -->
		<div class="mb-6">
			<div
				class="text-[10px] tracking-wide font-medium text-zinc-500 mb-4 pb-2 border-b border-vault-border"
			>
				Team Members
			</div>

			{#if investigation.members.length === 0}
				<p class="text-sm text-vault-text-dim">No members.</p>
			{:else}
				<div class="space-y-2">
					{#each investigation.members as member}
						<div
							class="flex items-center justify-between p-3 rounded-lg bg-vault-surface border border-vault-border"
						>
							<div class="flex items-center gap-2.5">
								<div
									class="w-6 h-6 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center"
								>
									<span class="text-[9px] text-vault-text-dim">
										{member.display_name
											.split(' ')
											.map((w) => w[0])
											.join('')
											.toUpperCase()
											.slice(0, 2)}
									</span>
								</div>
								<div>
									<p class="text-[13px] font-medium text-vault-text">
										{member.display_name}
									</p>
									<p class="text-[10px] text-vault-text-dim capitalize">
										{member.role}
									</p>
								</div>
							</div>
							<span class="font-mono text-[10px] text-vault-text-dim">
								Joined {formatDate(member.joined_at)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Notes -->
		<div>
			<div
				class="text-[10px] tracking-wide font-medium text-zinc-500 mb-4 pb-2 border-b border-vault-border"
			>
				Investigation Notes
			</div>

			{#if threadKey}
				<!-- New note form -->
				<div class="mb-4">
					<textarea
						bind:value={newNoteText}
						rows={2}
						class="w-full bg-vault-surface border border-vault-border rounded px-3 py-2 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-none"
						placeholder="Add an encrypted note…"
					></textarea>
					<button
						onclick={handleSaveNote}
						disabled={savingNote || !newNoteText.trim()}
						class="mt-1 px-3 py-1.5 rounded text-[11px] bg-white text-vault-bg font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{savingNote ? 'Saving…' : 'Add Note'}
					</button>
				</div>
			{:else}
				<p class="text-[11px] text-vault-text-dim mb-4">
					Thread key unavailable — cannot encrypt/decrypt notes.
				</p>
			{/if}

			{#if loadingNotes}
				<p class="text-sm text-vault-text-dim">Loading notes…</p>
			{:else if notes.length === 0}
				<p class="text-sm text-vault-text-dim">No notes yet.</p>
			{:else}
				<div class="space-y-3">
					{#each notes as note (note.id)}
						<div class="p-3 rounded-lg bg-vault-surface border border-vault-border">
							<div class="flex items-start justify-between mb-1">
								<div class="flex items-center gap-2">
									<span class="text-[12px] font-medium text-vault-text">
										{note.author_name || 'Unknown'}
									</span>
									<span class="text-[10px] text-vault-text-dim">
										{formatTime(note.created_at)}
									</span>
								</div>
								{#if note.journalist_id === user?.journalist_id}
									<button
										onclick={() => handleDeleteNote(note.id)}
										class="text-[10px] text-vault-text-dim hover:text-vault-red transition-colors"
									>
										Delete
									</button>
								{/if}
							</div>
							<p class="text-sm text-vault-text-muted whitespace-pre-wrap">
								{decryptedNotes.get(note.id) ?? '[encrypted]'}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
