<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomAuth, clearAuth } from '$lib/newsroom/auth';
	import { orgStore } from '$lib/newsroom/org';

	const currentPath = $derived($page.url.pathname as string);
	const isTipsActive = $derived(
		currentPath === '/newsroom/tips' || currentPath.startsWith('/newsroom/tips/')
	);
	const isInvestigationsActive = $derived(currentPath.startsWith('/newsroom/investigations'));
	const isTeamActive = $derived(currentPath.startsWith('/newsroom/team'));
	const isSettingsActive = $derived(currentPath.startsWith('/newsroom/settings'));

	const user = $derived($newsroomAuth.user);
	const org = $derived($orgStore);

	// Mobile sidebar toggle
	let mobileOpen = $state(false);

	function initials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function handleLogout() {
		clearAuth();
		goto('/newsroom/login');
	}

	function closeMobile() {
		mobileOpen = false;
	}
</script>

<!-- Mobile hamburger button — fixed but positioned to not overlap headers -->
<button
	onclick={() => { mobileOpen = !mobileOpen; }}
	class="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-vault-surface border border-vault-border shadow-lg"
	aria-label="Toggle menu"
>
	<svg class="w-5 h-5 text-vault-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		{#if mobileOpen}
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		{:else}
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
		{/if}
	</svg>
</button>

<!-- Mobile overlay -->
{#if mobileOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
		onclick={closeMobile}
		onkeydown={(e) => { if (e.key === 'Escape') closeMobile(); }}
	></div>
{/if}

<aside
	class="w-56 shrink-0 border-r border-vault-border bg-vault-surface flex flex-col h-screen
		md:sticky md:top-0
		max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:transition-transform max-md:duration-200
		{mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}"
>
	<!-- Brand -->
	<div class="px-5 py-5 border-b border-vault-border">
		<h1 class="text-sm font-semibold tracking-wide text-vault-text">
			{org?.name ?? 'Scrivault'}
		</h1>
		<p class="text-[11px] text-vault-text-dim mt-1">Organization</p>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 px-3 py-4 space-y-1">
		<div class="text-[10px] tracking-wide font-medium text-zinc-500 px-3 mb-2">
			Inbox
		</div>
		<a
			href="/newsroom/tips"
			onclick={closeMobile}
			class="flex items-center justify-between px-3 py-2 rounded text-[13px] transition-colors
				{isTipsActive
				? 'bg-vault-surface-raised text-vault-text border border-vault-border'
				: 'text-vault-text-muted hover:text-vault-text hover:bg-vault-surface-raised/50'}"
		>
			<span>Reports</span>
		</a>

		<div class="text-[10px] tracking-wide font-medium text-zinc-500 px-3 mt-5 mb-2">
			Investigations
		</div>
		<a
			href="/newsroom/investigations"
			onclick={closeMobile}
			class="flex items-center justify-between px-3 py-2 rounded text-[13px] transition-colors
				{isInvestigationsActive
				? 'bg-vault-surface-raised text-vault-text border border-vault-border'
				: 'text-vault-text-muted hover:text-vault-text hover:bg-vault-surface-raised/50'}"
		>
			<span>Investigations</span>
		</a>

		<div class="text-[10px] tracking-wide font-medium text-zinc-500 px-3 mt-5 mb-2">
			Team
		</div>
		<a
			href="/newsroom/team"
			onclick={closeMobile}
			class="flex items-center justify-between px-3 py-2 rounded text-[13px] transition-colors
				{isTeamActive
				? 'bg-vault-surface-raised text-vault-text border border-vault-border'
				: 'text-vault-text-muted hover:text-vault-text hover:bg-vault-surface-raised/50'}"
		>
			<span>Team</span>
		</a>
	</nav>

	<!-- User section -->
	{#if user}
		<div class="px-5 py-4 border-t border-vault-border">
			<div class="flex items-center gap-2.5 mb-3">
				<div
					class="w-7 h-7 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center"
				>
					<span class="font-mono text-[10px] text-vault-text-dim">
						{initials(user.display_name)}
					</span>
				</div>
				<div class="min-w-0">
					<p class="text-[13px] text-vault-text truncate">{user.display_name}</p>
					<p class="text-[10px] font-medium tracking-wide text-zinc-500 capitalize">{user.role === 'editor' ? 'Editor' : 'Responder'}</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<a
					href="/newsroom/settings"
					onclick={closeMobile}
					class="text-[11px] transition-colors {isSettingsActive ? 'text-vault-text' : 'text-vault-text-dim hover:text-vault-text'}"
				>
					Settings
				</a>
				<span class="text-vault-border">·</span>
				<button
					onclick={handleLogout}
					class="text-[11px] text-vault-text-dim hover:text-vault-text transition-colors"
				>
					Sign out
				</button>
			</div>
		</div>
	{/if}
</aside>
