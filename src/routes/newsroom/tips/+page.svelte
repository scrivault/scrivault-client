<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import type { TipSummary, TipStatus, TipFilterParams } from '$lib/newsroom/types';
	import TipTable from '../../components/newsroom/TipTable.svelte';
	import EmptyState from '../../components/newsroom/EmptyState.svelte';

	const user = $derived($newsroomAuth.user);

	let tips: TipSummary[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	let statusFilter: TipStatus | 'all' = $state('all');

	// Stats (always from the full 'all' load cached at mount)
	let allTips: TipSummary[] = $state([]);
	const stats = $derived({
		total: allTips.length,
		new: allTips.filter((t) => t.status === 'new').length,
		review: allTips.filter((t) => t.status === 'review').length,
		active: allTips.filter((t) => t.status === 'active').length,
		docs: allTips.reduce((sum, t) => sum + t.document_count, 0)
	});

	const filters: { label: string; value: TipStatus | 'all' }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'New', value: 'new' },
		{ label: 'Review', value: 'review' },
		{ label: 'Active', value: 'active' },
		{ label: 'Closed', value: 'closed' }
	];

	async function loadTips(filter?: TipFilterParams) {
		loading = true;
		error = '';
		try {
			const res = await newsroomApi.getTips(filter);
			tips = res.tips ?? [];
			// Cache full list for stats on initial/all load
			if (!filter?.status) {
				allTips = tips;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load reports.';
		} finally {
			loading = false;
		}
	}

	function handleFilterChange(value: TipStatus | 'all') {
		statusFilter = value;
		if (value === 'all') {
			loadTips();
		} else {
			loadTips({ status: value });
		}
	}

	function handleRowClick(tip: TipSummary) {
		goto(`/newsroom/tips/${tip.id}`);
	}

	// Build filter params from current state
	function currentFilter(): TipFilterParams | undefined {
		if (statusFilter === 'all') return undefined;
		return { status: statusFilter };
	}

	// Load on mount + poll every 30 seconds for new tips
	$effect(() => {
		loadTips();

		const interval = setInterval(() => {
			const filter = currentFilter();
			newsroomApi.getTips(filter).then((res) => {
				tips = res.tips ?? [];
			}).catch(() => {
				// Silent failure — will retry next interval
			});
			// Also refresh stats from full list
			if (filter) {
				newsroomApi.getTips().then((res) => {
					allTips = res.tips ?? [];
				}).catch(() => {});
			}
		}, 30_000);

		return () => {
			clearInterval(interval);
		};
	});
</script>

<svelte:head>
	<title>Reports — Scrivault</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between px-6 py-4 border-b border-vault-border bg-vault-surface"
>
	<h2 class="text-lg font-medium text-vault-text">Reports</h2>
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
				<span class="text-sm">Loading reports…</span>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<p class="text-sm text-vault-red mb-4">{error}</p>
				<button
					onclick={() => loadTips(currentFilter())}
					class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
				>
					Try again
				</button>
			</div>
		</div>
	{:else}
		<!-- Stats line -->
		<div class="text-[11px] text-vault-text-dim mb-5">
			{stats.total} reports · {stats.new} new · {stats.review} review · {stats.active} active · {stats.docs}
			docs
		</div>

		<!-- Filter bar -->
		<div class="flex gap-1 mb-5">
			{#each filters as f}
				<button
					onclick={() => handleFilterChange(f.value)}
					class="px-3 py-1.5 rounded text-[12px] transition-colors
						{statusFilter === f.value
						? 'bg-vault-surface-raised text-vault-text border border-vault-border'
						: 'text-vault-text-dim hover:text-vault-text-muted'}"
				>
					{f.label}
				</button>
			{/each}
		</div>

		<!-- Table -->
		{#if tips.length === 0}
			<EmptyState message="No reports match this filter." />
		{:else}
			<TipTable tips={tips} onRowClick={handleRowClick} currentUserId={user?.journalist_id ?? null} />
		{/if}
	{/if}
</div>
