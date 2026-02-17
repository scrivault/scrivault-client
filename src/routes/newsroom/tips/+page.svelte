<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import type { TipSummary, TipStatus } from '$lib/newsroom/types';
	import TipTable from '../../components/newsroom/TipTable.svelte';
	import EmptyState from '../../components/newsroom/EmptyState.svelte';

	let tips: TipSummary[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	let statusFilter: TipStatus | 'all' = $state('all');

	// Filtered tips
	const filteredTips = $derived(
		statusFilter === 'all' ? tips : tips.filter((t) => t.status === statusFilter)
	);

	// Stats
	const stats = $derived({
		total: tips.length,
		new: tips.filter((t) => t.status === 'new').length,
		review: tips.filter((t) => t.status === 'review').length,
		active: tips.filter((t) => t.status === 'active').length,
		docs: tips.reduce((sum, t) => sum + t.document_count, 0)
	});

	const filters: { label: string; value: TipStatus | 'all' }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'New', value: 'new' },
		{ label: 'Review', value: 'review' },
		{ label: 'Active', value: 'active' },
		{ label: 'Closed', value: 'closed' }
	];

	async function loadTips() {
		loading = true;
		error = '';
		try {
			const res = await newsroomApi.getTips();
			tips = res.tips ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load tips.';
		} finally {
			loading = false;
		}
	}

	function handleRowClick(tip: TipSummary) {
		goto(`/newsroom/tips/${tip.id}`);
	}

	$effect(() => {
		loadTips();
	});
</script>

<svelte:head>
	<title>Tips — Scrivault Newsroom</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between px-6 py-4 border-b border-vault-border bg-vault-surface"
>
	<h2 class="text-lg font-medium text-vault-text">Tips</h2>
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
				<span class="text-sm">Loading tips…</span>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<p class="text-sm text-vault-red mb-4">{error}</p>
				<button
					onclick={loadTips}
					class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
				>
					Try again
				</button>
			</div>
		</div>
	{:else}
		<!-- Stats line -->
		<div class="font-mono text-[11px] text-vault-text-dim mb-5">
			{stats.total} tips · {stats.new} new · {stats.review} review · {stats.active} active · {stats.docs}
			docs
		</div>

		<!-- Filter bar -->
		<div class="flex gap-1 mb-5">
			{#each filters as f}
				<button
					onclick={() => (statusFilter = f.value)}
					class="px-3 py-1.5 rounded text-[12px] font-mono transition-colors
						{statusFilter === f.value
						? 'bg-vault-surface-raised text-vault-text border border-vault-border'
						: 'text-vault-text-dim hover:text-vault-text-muted'}"
				>
					{f.label}
				</button>
			{/each}
		</div>

		<!-- Table -->
		{#if filteredTips.length === 0}
			<EmptyState message="No tips match this filter." />
		{:else}
			<TipTable tips={filteredTips} onRowClick={handleRowClick} />
		{/if}
	{/if}
</div>
