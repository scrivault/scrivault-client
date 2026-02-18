<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import {
		unsealThreadKey,
		decryptMessage,
		encryptMessage,
		sealThreadKeyForJournalist,
		fromBase64,
		toBase64
	} from '$lib/crypto';
	import { ApiError } from '$lib/api';
	import { getToken } from '$lib/newsroom/auth';
	import { createWsConnection, newsroomWsUrl } from '$lib/ws';
	import type { NewsroomMessage, TipStatus, TeamMember } from '$lib/newsroom/types';
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
		if (msg.sender_role === 'source') return 'Source';
		return user?.display_name ?? 'Journalist';
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

			// Attempt to unseal the thread key and decrypt messages
			await attemptDecryption();
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
			}
		});

		return () => {
			destroyWs();
		};
	});
</script>

<svelte:head>
	<title>Thread {shortId}… — Scrivault Newsroom</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between px-6 py-3 border-b border-vault-border bg-vault-surface shrink-0"
>
	<div class="flex items-center gap-3">
		<a
			href="/newsroom/tips"
			aria-label="Back to tips"
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
			<h2 class="text-sm font-medium text-vault-text">Thread</h2>
			<span class="font-mono text-[11px] text-vault-text-dim">{shortId}…</span>
		</div>
	</div>
	<div class="flex items-center gap-2">
		{#if canDecrypt}
			<div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-vault-green/30 bg-vault-green-muted">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
				<span class="font-mono text-[10px] text-vault-green">ENCRYPTED</span>
			</div>
		{:else if !loading && !error}
			<div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-vault-amber/20 bg-vault-amber/10">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
				<span class="font-mono text-[10px] text-vault-amber">ENCRYPTED</span>
			</div>
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
			<span class="text-sm">Loading thread…</span>
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
						class="px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors
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
							<span class="font-mono text-[7px] text-vault-text-dim">
								{initials(assigneeName ?? '??')}
							</span>
						</div>
						<span class="text-[10px] font-mono text-vault-text-muted">
							{isAssignedToMe ? 'Assigned to you' : `Assigned to ${assigneeName ?? 'Unknown'}`}
						</span>
					</div>
					{#if isEditor}
						<button
							onclick={handleUnassign}
							disabled={updating}
							class="text-[10px] font-mono text-vault-text-dim hover:text-vault-red transition-colors disabled:opacity-30"
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
						class="text-[10px] font-mono text-vault-text-dim hover:text-vault-text transition-colors disabled:opacity-30"
					>
						Assign to me
					</button>
				{/if}
			{/if}

			{#if isEditor && canDecrypt}
				<button
					onclick={openAssignModal}
					disabled={updating}
					class="text-[10px] font-mono text-vault-text-dim hover:text-vault-text transition-colors disabled:opacity-30"
				>
					Assign to reporter
				</button>
			{/if}

			<!-- Promote — stays prominent -->
			{#if isEditor}
				<button
					onclick={openInvestigationModal}
					disabled={updating}
					class="ml-auto px-2.5 py-1 rounded text-[10px] font-mono text-vault-green hover:text-vault-green-dim bg-vault-green-muted border border-vault-green/20 transition-colors disabled:opacity-30"
				>
					Create Investigation
				</button>
			{/if}
		</div>

		{#if updateError}
			<p class="text-[10px] text-vault-red mt-1.5">{updateError}</p>
		{/if}
	</div>

	<!-- Decryption status notice -->
	{#if decryptError}
		<div class="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-amber/10 border border-vault-amber/20 shrink-0">
			<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60 shrink-0"></div>
			<span class="font-mono text-[11px] text-vault-amber">{decryptError}</span>
		</div>
	{/if}

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto px-6 py-6">
		{#if messages.length === 0}
			<div class="flex items-center justify-center py-12 text-sm text-vault-text-dim">
				No messages in this thread.
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
		<div bind:this={scrollAnchor}></div>
	</div>

	<!-- Reply area -->
	<div class="shrink-0 px-6 py-3 border-t border-vault-border bg-vault-surface/80 backdrop-blur-sm">
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
				<span class="font-mono text-[11px] text-vault-text-dim">
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
		aria-label="Assign to reporter"
	>
		<div class="w-full max-w-sm mx-4 rounded-lg bg-vault-surface border border-vault-border shadow-2xl">
			<div class="px-4 py-3 border-b border-vault-border">
				<h3 class="font-mono text-xs text-vault-text">Assign to team member</h3>
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
								<span class="font-mono text-[9px] text-vault-text-dim">
									{initials(member.display_name)}
								</span>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-sm text-vault-text truncate">{member.display_name}</p>
								<p class="font-mono text-[10px] text-vault-text-dim uppercase">{member.role}</p>
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
					class="w-full px-3 py-2 rounded text-[11px] font-mono text-vault-text-muted hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors"
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
				<h3 class="font-mono text-xs text-vault-text">Create Investigation</h3>
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
						class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
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
						class="flex-1 px-3 py-2 rounded text-[11px] font-mono text-vault-text-muted bg-vault-surface-raised border border-vault-border hover:text-vault-text transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!investigationCodename.trim() || creatingInvestigation}
						class="flex-1 px-3 py-2 rounded text-[11px] font-mono text-black bg-vault-green hover:bg-vault-green-dim border border-vault-green/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{creatingInvestigation ? 'Creating…' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
