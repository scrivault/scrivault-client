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
	import type { NewsroomMessage, TipStatus } from '$lib/newsroom/types';
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
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let updateError = $state('');

	// Reply state
	let replyText = $state('');
	let sendingReply = $state(false);
	let replyError = $state('');

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
		}
	}

	async function attemptDecryption() {
		if (!privateKey || !publicKey) {
			decryptError = 'No decryption keys available — keypair not loaded';
			canDecrypt = false;
			return;
		}

		try {
			// Fetch the sealed key for this journalist
			const sealedRes = await newsroomApi.getSealedKey(threadId);
			const sealed = fromBase64(sealedRes.sealed_key);

			// Unseal with our keypair
			threadKey = await unsealThreadKey(sealed, publicKey, privateKey);
			canDecrypt = true;

			// Decrypt all messages
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
				// Individual message decryption failure — leave as encrypted
				console.warn(`Failed to decrypt message ${msg.id}`);
			}
		}
		decryptedTexts = newMap;
	}

	async function handleStatusChange(newStatus: TipStatus) {
		if (newStatus === tipStatus) return;
		updating = true;
		updateError = '';
		try {
			await newsroomApi.updateTip(threadId, { status: newStatus });
			tipStatus = newStatus;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to update status.';
		} finally {
			updating = false;
		}
	}

	async function handleAssignToMe() {
		if (!user) return;
		updating = true;
		updateError = '';
		try {
			// If we're an editor with the thread key, self-grant if not already granted
			if (isEditor && threadKey && publicKey) {
				try {
					await newsroomApi.getSealedKey(threadId);
				} catch (err) {
					// No grant exists — self-grant
					if (err instanceof ApiError && err.status === 404) {
						const sealed = await sealThreadKeyForJournalist(threadKey, publicKey);
						await newsroomApi.grantKey(threadId, {
							journalist_id: user.journalist_id,
							sealed_key: toBase64(sealed)
						});
					}
				}
			}

			await newsroomApi.updateTip(threadId, { assigned_to: user.journalist_id });
			assignedTo = user.journalist_id;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to assign.';
		} finally {
			updating = false;
		}
	}

	async function handleAssignToReporter() {
		if (!isEditor || !threadKey) return;

		const reporterId = prompt('Enter reporter journalist ID:');
		if (!reporterId?.trim()) return;

		updating = true;
		updateError = '';
		try {
			// Fetch reporter's public key
			const pubkeysRes = await newsroomApi.getReporterPublicKeys();
			const reporter = pubkeysRes.keys.find((k) => k.journalist_id === reporterId.trim());
			if (!reporter) {
				updateError = 'Reporter not found or has no public key.';
				updating = false;
				return;
			}

			// Seal thread key for reporter
			const reporterPubKey = fromBase64(reporter.public_key);
			const sealed = await sealThreadKeyForJournalist(threadKey, reporterPubKey);

			// Grant key and assign
			await newsroomApi.grantKey(threadId, {
				journalist_id: reporterId.trim(),
				sealed_key: toBase64(sealed)
			});
			await newsroomApi.updateTip(threadId, { assigned_to: reporterId.trim() });
			assignedTo = reporterId.trim();
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to assign reporter.';
		} finally {
			updating = false;
		}
	}

	async function handlePromoteToInvestigation() {
		const codename = prompt('Enter investigation codename:');
		if (!codename?.trim()) return;
		updating = true;
		updateError = '';
		try {
			const inv = await newsroomApi.createInvestigation({
				thread_id: threadId,
				codename: codename.trim()
			});
			goto(`/newsroom/investigations/${inv.id}`);
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to create investigation.';
			updating = false;
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

			// Reload thread to show new message
			const res = await newsroomApi.getMessages(threadId);
			messages = res.messages ?? [];
			await decryptAllMessages();
		} catch (err) {
			replyError = err instanceof Error ? err.message : 'Failed to send reply.';
		} finally {
			sendingReply = false;
		}
	}

	$effect(() => {
		if (threadId) loadThread();
	});
</script>

<svelte:head>
	<title>Thread {shortId}… — Scrivault Newsroom</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between px-6 py-4 border-b border-vault-border bg-vault-surface"
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
			<div class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-vault-green-muted border border-vault-green/20">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
				<span class="font-mono text-[9px] text-vault-green uppercase tracking-wider">Decrypted</span>
			</div>
		{:else if !loading && !error}
			<div class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-vault-amber/10 border border-vault-amber/20">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
				<span class="font-mono text-[9px] text-vault-amber uppercase tracking-wider">Encrypted</span>
			</div>
		{/if}
		<StatusPill status={tipStatus} />
	</div>
</div>

<!-- Content -->
<div class="flex-1 overflow-y-auto">
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
				<span class="text-sm">Loading thread…</span>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-20">
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
		<div class="px-6 py-4 border-b border-vault-border bg-vault-surface/50">
			<div class="flex items-center gap-4 flex-wrap">
				<!-- Status selector -->
				<div class="flex items-center gap-2">
					<span class="font-mono text-[9px] tracking-wider uppercase text-vault-text-dim">
						Status
					</span>
					<div class="flex gap-1">
						{#each statuses as s}
							<button
								onclick={() => handleStatusChange(s)}
								disabled={updating}
								class="px-2 py-1 rounded text-[11px] font-mono transition-colors
									{tipStatus === s
									? 'bg-vault-surface-raised text-vault-text border border-vault-border'
									: 'text-vault-text-dim hover:text-vault-text-muted'}"
							>
								{s}
							</button>
						{/each}
					</div>
				</div>

				<!-- Assign to me -->
				{#if !assignedTo || isEditor}
					<button
						onclick={handleAssignToMe}
						disabled={updating}
						class="px-3 py-1 rounded text-[11px] font-mono text-vault-text-muted hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors disabled:opacity-30"
					>
						Assign to me
					</button>
				{/if}

				<!-- Assign to reporter (editors with thread key only) -->
				{#if isEditor && canDecrypt}
					<button
						onclick={handleAssignToReporter}
						disabled={updating}
						class="px-3 py-1 rounded text-[11px] font-mono text-vault-text-muted hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors disabled:opacity-30"
					>
						Assign to reporter
					</button>
				{/if}

				<!-- Promote to investigation (editors only) -->
				{#if isEditor}
					<button
						onclick={handlePromoteToInvestigation}
						disabled={updating}
						class="px-3 py-1 rounded text-[11px] font-mono text-vault-green hover:text-vault-green-dim bg-vault-green-muted border border-vault-green/20 transition-colors disabled:opacity-30"
					>
						Create Investigation
					</button>
				{/if}
			</div>

			{#if updateError}
				<p class="text-[11px] text-vault-red mt-2">{updateError}</p>
			{/if}
		</div>

		<!-- Decryption status notice -->
		{#if decryptError}
			<div class="mx-6 mt-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-vault-amber/10 border border-vault-amber/20">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60 shrink-0"></div>
				<span class="font-mono text-[11px] text-vault-amber">{decryptError}</span>
			</div>
		{/if}

		<!-- Messages -->
		<div class="px-6 py-6 space-y-4">
			{#if messages.length === 0}
				<div class="flex items-center justify-center py-12 text-sm text-vault-text-dim">
					No messages in this thread.
				</div>
			{:else}
				{#each messages as msg (msg.id)}
					<MessageBubble message={msg} decryptedText={decryptedTexts.get(msg.id)} />
				{/each}
			{/if}
		</div>

		<!-- Reply area -->
		<div class="px-6 py-4 border-t border-vault-border bg-vault-surface/50">
			{#if canDecrypt}
				<!-- Reply form -->
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSendReply();
					}}
					class="space-y-3"
				>
					<textarea
						bind:value={replyText}
						rows={3}
						placeholder="Type your reply… (encrypted with thread key)"
						disabled={sendingReply}
						class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors resize-y min-h-20 disabled:opacity-50"
					></textarea>

					{#if replyError}
						<p class="text-[11px] text-vault-red">{replyError}</p>
					{/if}

					<div class="flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
							<span class="font-mono text-[9px] text-vault-green/70 uppercase tracking-wider">
								End-to-end encrypted
							</span>
						</div>
						<button
							type="submit"
							disabled={!replyText.trim() || sendingReply}
							class="px-4 py-1.5 rounded-lg bg-vault-green hover:bg-vault-green-dim text-black text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
						>
							{sendingReply ? 'Sending…' : 'Send Reply'}
						</button>
					</div>
				</form>
			{:else}
				<div
					class="flex items-center gap-2 px-3 py-3 rounded-lg bg-vault-surface border border-vault-border"
				>
					<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
					<span class="font-mono text-[11px] text-vault-text-dim">
						{decryptError || 'No decryption key available — replies disabled'}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
