<script lang="ts">
	import type { TipStatus } from '$lib/newsroom/types';

	let { status }: { status: TipStatus } = $props();

	const styles: Record<TipStatus, string> = {
		new: 'text-vault-amber bg-vault-amber-muted border-vault-amber/30',
		review: 'text-vault-blue bg-vault-blue-muted border-vault-blue/30',
		active: 'text-vault-green bg-vault-green-muted border-vault-green/30',
		closed: 'text-vault-text-dim bg-vault-surface-raised border-vault-border'
	};
</script>

<span
	class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border {styles[status]}"
>
	<span class="text-[6px]">●</span>
	{status}
</span>
