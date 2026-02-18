<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { orgStore } from '$lib/newsroom/org';

	let { children } = $props();
	let checked = $state(false);

	onMount(() => {
		newsroomApi
			.getSetupStatus()
			.then((res) => {
				if (res.needs_setup) {
					goto('/setup');
				} else if (res.organization) {
					orgStore.set(res.organization);
				}
				checked = true;
			})
			.catch(() => {
				// Proceed even if check fails (server down, etc.)
				checked = true;
			});
	});
</script>

{#if checked}
	{@render children()}
{/if}
