<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import type { NewsroomMessage, TipStatus } from '$lib/newsroom/types';
	import MessageBubble from '../../../components/newsroom/MessageBubble.svelte';
	import StatusPill from '../../../components/newsroom/StatusPill.svelte';

	const threadId = $derived($page.params.threadId ?? '');
	const shortId = $derived(threadId.slice(0, 12));
	const user = $derived($newsroomAuth.user);
	const isEditor = $derived(user?.role === 'editor');

	let messages: NewsroomMessage[] = $state([]);
	let tipStatus: TipStatus = $state('new');
	let assignedTo: string | null = $state(null);
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let updateError = $state('');

	const statuses: TipStatus[] = ['new', 'review', 'active', 'closed'];

	async function loadThread() {
		loading = true;
		error = '';
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
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load thread.';
		} finally {
			loading = false;
		}
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
			await newsroomApi.updateTip(threadId, { assigned_to: user.journalist_id });
			assignedTo = user.journalist_id;
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Failed to assign.';
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

				<!-- Assign -->
				{#if !assignedTo || isEditor}
					<button
						onclick={handleAssignToMe}
						disabled={updating}
						class="px-3 py-1 rounded text-[11px] font-mono text-vault-text-muted hover:text-vault-text bg-vault-surface-raised border border-vault-border transition-colors disabled:opacity-30"
					>
						Assign to me
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

		<!-- Messages -->
		<div class="px-6 py-6 space-y-4">
			{#if messages.length === 0}
				<div class="flex items-center justify-center py-12 text-sm text-vault-text-dim">
					No messages in this thread.
				</div>
			{:else}
				{#each messages as msg (msg.id)}
					<MessageBubble message={msg} />
				{/each}
			{/if}
		</div>

		<!-- Reply area (disabled — key exchange not yet implemented) -->
		<div class="px-6 py-4 border-t border-vault-border bg-vault-surface/50">
			<div
				class="flex items-center gap-2 px-3 py-3 rounded-lg bg-vault-surface border border-vault-border"
			>
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
				<span class="font-mono text-[11px] text-vault-text-dim">
					Replies require key exchange — coming soon
				</span>
			</div>
		</div>
	{/if}
</div>
