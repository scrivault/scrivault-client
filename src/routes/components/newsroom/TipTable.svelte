<script lang="ts">
	import type { TipSummary } from '$lib/newsroom/types';
	import StatusPill from './StatusPill.svelte';

	let {
		tips,
		onRowClick,
		currentUserId = null
	}: {
		tips: TipSummary[];
		onRowClick: (tip: TipSummary) => void;
		currentUserId?: string | null;
	} = $props();

	function formatTimeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function truncateId(id: string): string {
		return id.slice(0, 12);
	}

	function initials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}
</script>

<table class="w-full border-collapse">
	<thead>
		<tr>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Status
			</th>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Tip
			</th>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Assigned
			</th>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Msgs
			</th>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Docs
			</th>
			<th
				class="text-left font-mono text-[9px] tracking-[1.5px] uppercase text-vault-text-dim font-medium px-3 py-2 border-b border-vault-border"
			>
				Last Activity
			</th>
		</tr>
	</thead>
	<tbody>
		{#each tips as tip (tip.id)}
			{@const hasUnread = tip.unread_count > 0}
			<tr
				onclick={() => onRowClick(tip)}
				class="border-b border-vault-border cursor-pointer transition-colors hover:bg-vault-surface {hasUnread ? 'font-medium' : ''}"
			>
				<td class="px-3 py-3.5 align-middle">
					<StatusPill status={tip.status} />
				</td>
				<td class="px-3 py-3.5 align-middle">
					<span class="font-mono text-[12px] text-vault-text">{truncateId(tip.blinded_id)}…</span>
				</td>
				<td class="px-3 py-3.5 align-middle">
					{#if tip.assignee_name}
						{@const isMe = currentUserId && tip.assigned_to === currentUserId}
						<div class="flex items-center gap-1.5">
							<div
								class="w-5 h-5 rounded-full flex items-center justify-center
									{isMe
									? 'bg-vault-green-muted border border-vault-green/30'
									: 'bg-vault-surface-raised border border-vault-border'}"
							>
								<span class="font-mono text-[8px] {isMe ? 'text-vault-green' : 'text-vault-text-dim'}">
									{initials(tip.assignee_name)}
								</span>
							</div>
							{#if isMe}
								<span class="text-[12px] font-mono text-vault-green">You</span>
							{:else}
								<span class="text-[12px] text-vault-text-muted">{tip.assignee_name}</span>
							{/if}
						</div>
					{:else}
						<span class="text-[12px] text-vault-text-dim italic">Unassigned</span>
					{/if}
				</td>
				<td class="px-3 py-3.5 align-middle">
					<span class="font-mono text-[11px] text-vault-text-muted">{tip.message_count}</span>
					{#if hasUnread}
						<span class="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-vault-amber text-[9px] font-mono font-bold text-vault-bg">{tip.unread_count}</span>
					{/if}
				</td>
				<td class="px-3 py-3.5 align-middle">
					<span class="font-mono text-[11px] text-vault-text-muted">{tip.document_count}</span>
				</td>
				<td class="px-3 py-3.5 align-middle">
					<span class="font-mono text-[11px] text-vault-text-dim">
						{formatTimeAgo(tip.last_activity)}
					</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
