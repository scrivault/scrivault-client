<script lang="ts">
	import type { TipStatus } from '$lib/newsroom/types';

	let { status }: { status: TipStatus } = $props();

	const dotColors: Record<TipStatus, string> = {
		new: 'bg-amber-400',
		review: 'bg-blue-400',
		active: 'bg-emerald-400',
		closed: 'bg-zinc-500'
	};

	const textColors: Record<TipStatus, string> = {
		new: 'text-amber-400/80',
		review: 'text-blue-400/80',
		active: 'text-emerald-400/80',
		closed: 'text-zinc-500'
	};
</script>

<span class="inline-flex items-center gap-1.5">
	<span class="w-1.5 h-1.5 rounded-full {dotColors[status]}"></span>
	<span class="text-xs font-medium capitalize {textColors[status]}">
		{status}
	</span>
</span>
