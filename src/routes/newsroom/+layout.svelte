<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomAuth, isAuthenticated } from '$lib/newsroom/auth';
	import Sidebar from '../components/newsroom/Sidebar.svelte';

	let { children } = $props();

	const publicPaths = ['/newsroom/login', '/newsroom/register'];
	const isPublicPage = $derived(publicPaths.includes($page.url.pathname as string));

	$effect(() => {
		if (!isPublicPage && !isAuthenticated()) {
			goto('/newsroom/login');
		}
	});
</script>

{#if isPublicPage}
	{@render children()}
{:else if $newsroomAuth.token}
	<div class="min-h-screen flex bg-vault-bg">
		<Sidebar />
		<main class="flex-1 min-w-0 flex flex-col overflow-hidden">
			{@render children()}
		</main>
	</div>
{/if}
