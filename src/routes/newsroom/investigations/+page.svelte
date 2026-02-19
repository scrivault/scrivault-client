<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import type { InvestigationSummary } from '$lib/newsroom/types';
	import EmptyState from '../../components/newsroom/EmptyState.svelte';

	const isEditor = $derived($newsroomAuth.user?.role === 'editor');

	let investigations: InvestigationSummary[] = $state([]);
	let loading = $state(true);
	let error = $state('');

	// Create form
	let showCreate = $state(false);
	let newCodename = $state('');
	let newThreadId = $state('');
	let creating = $state(false);
	let createError = $state('');

	async function loadInvestigations() {
		loading = true;
		error = '';
		try {
			const res = await newsroomApi.getInvestigations();
			investigations = res.investigations ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load investigations.';
		} finally {
			loading = false;
		}
	}

	async function handleCreate() {
		if (!newCodename.trim() || !newThreadId.trim()) return;
		creating = true;
		createError = '';
		try {
			await newsroomApi.createInvestigation({
				thread_id: newThreadId.trim(),
				codename: newCodename.trim()
			});
			showCreate = false;
			newCodename = '';
			newThreadId = '';
			await loadInvestigations();
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Failed to create investigation.';
		} finally {
			creating = false;
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	$effect(() => {
		loadInvestigations();
	});
</script>

<svelte:head>
	<title>Investigations — Scrivault</title>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between pl-14 pr-6 md:px-6 py-4 border-b border-vault-border bg-vault-surface"
>
	<h2 class="text-lg font-medium text-vault-text">Investigations</h2>
	{#if isEditor}
		<button
			onclick={() => (showCreate = !showCreate)}
			class="px-3 py-1.5 rounded-lg text-[12px] bg-white text-vault-bg font-medium transition-colors hover:bg-neutral-200"
		>
			{showCreate ? 'Cancel' : 'New Investigation'}
		</button>
	{/if}
</div>

<!-- Content -->
<div class="flex-1 overflow-y-auto px-6 py-5">
	<!-- Create form -->
	{#if showCreate}
		<div class="mb-6 p-4 rounded-lg bg-vault-surface border border-vault-border">
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleCreate();
				}}
				class="space-y-3"
			>
				<div>
					<label
						for="codename"
						class="block text-[10px] tracking-wide font-medium text-zinc-500 mb-1.5"
					>
						Codename
					</label>
					<input
						id="codename"
						type="text"
						bind:value={newCodename}
						class="w-full bg-vault-bg border border-vault-border rounded px-3 py-2 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
						placeholder="e.g. Project Chimera"
					/>
				</div>
				<div>
					<label
						for="thread-id"
						class="block text-[10px] tracking-wide font-medium text-zinc-500 mb-1.5"
					>
						Report ID
					</label>
					<input
						id="thread-id"
						type="text"
						bind:value={newThreadId}
						class="w-full bg-vault-bg border border-vault-border rounded px-3 py-2 text-sm font-mono text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
						placeholder="UUID of the report"
					/>
				</div>
				{#if createError}
					<p class="text-[11px] text-vault-red">{createError}</p>
				{/if}
				<button
					type="submit"
					disabled={creating || !newCodename.trim() || !newThreadId.trim()}
					class="px-4 py-2 rounded text-[12px] bg-white text-vault-bg font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
				>
					{creating ? 'Creating…' : 'Create'}
				</button>
			</form>
		</div>
	{/if}

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
				<span class="text-sm">Loading investigations…</span>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<p class="text-sm text-vault-red mb-4">{error}</p>
				<button
					onclick={loadInvestigations}
					class="text-sm text-vault-text-muted hover:text-vault-text underline underline-offset-2"
				>
					Try again
				</button>
			</div>
		</div>
	{:else if investigations.length === 0}
		<EmptyState message="No investigations yet." />
	{:else}
		<div class="text-[11px] text-vault-text-dim mb-5">
			{investigations.length} investigation{investigations.length !== 1 ? 's' : ''}
		</div>

		<table class="w-full border-collapse">
			<thead>
				<tr>
					<th
						class="text-left text-[10px] tracking-wide text-zinc-500 font-medium px-3 py-2 border-b border-vault-border"
					>
						Codename
					</th>
					<th
						class="text-left text-[10px] tracking-wide text-zinc-500 font-medium px-3 py-2 border-b border-vault-border"
					>
						Report
					</th>
					<th
						class="text-left text-[10px] tracking-wide text-zinc-500 font-medium px-3 py-2 border-b border-vault-border"
					>
						Created
					</th>
				</tr>
			</thead>
			<tbody>
				{#each investigations as inv (inv.id)}
					<tr
						onclick={() => goto(`/newsroom/investigations/${inv.id}`)}
						class="border-b border-vault-border cursor-pointer transition-colors hover:bg-vault-surface"
					>
						<td class="px-3 py-3.5 align-middle">
							<span class="text-[13px] font-medium text-vault-text">{inv.codename}</span>
						</td>
						<td class="px-3 py-3.5 align-middle">
							<span class="font-mono text-[11px] text-vault-text-muted">
								{inv.thread_id.slice(0, 12)}…
							</span>
						</td>
						<td class="px-3 py-3.5 align-middle">
							<span class="text-[11px] text-vault-text-dim">
								{formatDate(inv.created_at)}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
