<script lang="ts">
	import type { NewsroomMessage } from '$lib/newsroom/types';

	let {
		message,
		decryptedText = undefined,
		senderLabel = undefined
	}: {
		message: NewsroomMessage;
		decryptedText?: string | undefined;
		senderLabel?: string | undefined;
	} = $props();

	const isSource = $derived(message.sender_role === 'source');
	const isDecrypted = $derived(decryptedText !== undefined);

	const label = $derived(senderLabel ?? (isSource ? 'Source' : 'Journalist'));

	function relativeTime(iso: string): string {
		const date = new Date(iso);
		const now = Date.now();
		const diff = now - date.getTime();

		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return 'Just now';

		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;

		const days = Math.floor(hours / 24);
		if (days === 1) {
			return 'Yesterday, ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		}
		if (days < 7) return `${days}d ago`;

		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
			', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}

	function truncateCiphertext(ct: string): string {
		if (ct.length <= 48) return ct;
		return ct.slice(0, 48) + '…';
	}
</script>

<div class="flex {isSource ? 'justify-start' : 'justify-end'}">
	<div
		class="max-w-[80%] rounded-lg px-4 py-2.5
			{isSource
			? 'bg-vault-surface border border-vault-border'
			: 'bg-vault-green-muted border border-vault-green/20'}"
	>
		<!-- Header -->
		<div class="flex items-center gap-2 mb-1">
			<span
				class="font-mono text-[10px] uppercase tracking-wider
					{isSource ? 'text-vault-text-muted' : 'text-vault-green/70'}"
			>
				{label}
			</span>
			<span class="text-[10px] text-vault-text-dim">
				{relativeTime(message.created_at)}
			</span>
		</div>

		{#if isDecrypted}
			<p class="text-sm text-vault-text whitespace-pre-wrap break-words">{decryptedText}</p>
		{:else}
			<div class="font-mono text-[11px] text-vault-text-muted break-all leading-relaxed">
				{truncateCiphertext(message.ciphertext)}
			</div>
			<div class="mt-1.5 flex items-center gap-1.5">
				<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
				<span class="font-mono text-[9px] text-vault-text-dim uppercase tracking-wider">
					Encrypted
				</span>
			</div>
		{/if}
	</div>
</div>
