<script lang="ts">
	import { page } from '$app/stores';
	import { newsroomApi } from '$lib/newsroom/api';
	import type { InvestigationDetailResponse } from '$lib/newsroom/types';

	const invId = $derived(($page.params as Record<string, string>).id ?? '');

	let investigation: InvestigationDetailResponse | null = $state(null);
	let loading = $state(true);
	let error = $state('');

	async function loadInvestigation() {
		loading = true;
		error = '';
		try {
			investigation = await newsroomApi.getInvestigation(invId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load investigation.';
		} finally {
			loading = false;
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
		if (invId) loadInvestigation();
	});
</script>

<svelte:head>
	<title
		>{investigation ? investigation.codename : 'Investigation'} — Scrivault</title
	>
</svelte:head>

<!-- Header -->
<div
	class="flex items-center justify-between px-6 py-4 border-b border-vault-border bg-vault-surface"
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
			<h3 class="text-xl font-medium text-vault-text mb-1">{investigation.codename}</h3>
			<div class="font-mono text-[11px] text-vault-text-dim mb-4">
				Report {investigation.thread_id.slice(0, 12)}…
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
						Source Report
					</span>
					<a
						href="/newsroom/tips/{investigation.thread_id}"
						class="text-[13px] text-vault-text-muted hover:text-vault-text underline underline-offset-2 transition-colors"
					>
						View report
					</a>
				</div>
			</div>
		</div>

		<!-- Members -->
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
	{/if}
</div>
