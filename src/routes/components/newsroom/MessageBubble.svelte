<script lang="ts">
	import type { NewsroomMessage } from '$lib/newsroom/types';

	let { message }: { message: NewsroomMessage } = $props();

	const isSource = $derived(message.sender_role === 'source');

	function formatTime(iso: string): string {
		const date = new Date(iso);
		return (
			date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
			', ' +
			date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
		);
	}

	function truncateCiphertext(ct: string): string {
		if (ct.length <= 48) return ct;
		return ct.slice(0, 48) + '…';
	}
</script>

<div class="flex {isSource ? 'justify-start' : 'justify-end'}">
	<div
		class="max-w-[80%] rounded-lg px-4 py-3
			{isSource
			? 'bg-vault-surface border border-vault-border'
			: 'bg-vault-green-muted border border-vault-green/20'}"
	>
		<!-- Header -->
		<div class="flex items-center gap-2 mb-1.5">
			<span
				class="font-mono text-[10px] uppercase tracking-wider
					{isSource ? 'text-vault-text-muted' : 'text-vault-green/70'}"
			>
				{isSource ? 'Source' : 'Journalist'}
			</span>
			<span class="font-mono text-[10px] text-vault-text-dim">
				#{message.ordinal}
			</span>
			<span class="text-[10px] text-vault-text-dim">
				{formatTime(message.created_at)}
			</span>
		</div>

		<!-- Encrypted content -->
		<div class="font-mono text-[11px] text-vault-text-muted break-all leading-relaxed">
			{truncateCiphertext(message.ciphertext)}
		</div>
		<div class="mt-1.5 flex items-center gap-1.5">
			<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
			<span class="font-mono text-[9px] text-vault-text-dim uppercase tracking-wider">
				Encrypted
			</span>
		</div>
	</div>
</div>
