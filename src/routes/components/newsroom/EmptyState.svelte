<script lang="ts">
	let { message }: { message: string } = $props();
</script>

<div class="flex items-center justify-center py-20">
	<p class="text-sm text-vault-text-dim">{message}</p>
</div>
