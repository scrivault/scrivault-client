<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { newsroomAuth, clearAuth } from '$lib/newsroom/auth';

	const currentPath = $derived($page.url.pathname as string);
	const isTipsActive = $derived(
		currentPath === '/newsroom/tips' || currentPath.startsWith('/newsroom/tips/')
	);
	const isInvestigationsActive = $derived(currentPath.startsWith('/newsroom/investigations'));

	const user = $derived($newsroomAuth.user);

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
</script>

<aside
	class="w-56 shrink-0 border-r border-vault-border bg-vault-surface flex flex-col h-screen sticky top-0"
>
	<!-- Brand -->
	<div class="px-5 py-5 border-b border-vault-border">
		<h1 class="font-mono text-xs font-semibold tracking-[2px] uppercase text-vault-text">
			Scrivault
		</h1>
		<p class="text-[11px] text-vault-text-dim mt-1">Newsroom</p>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 px-3 py-4 space-y-1">
		<div class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim px-3 mb-2">
			Tip Queue
		</div>
		<a
			href="/newsroom/tips"
			class="flex items-center justify-between px-3 py-2 rounded text-[13px] transition-colors
				{isTipsActive
				? 'bg-vault-surface-raised text-vault-text border border-vault-border'
				: 'text-vault-text-muted hover:text-vault-text hover:bg-vault-surface-raised/50'}"
		>
			<span>All Tips</span>
		</a>

		<div
			class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim px-3 mt-5 mb-2"
		>
			Investigations
		</div>
		<a
			href="/newsroom/investigations"
			class="flex items-center justify-between px-3 py-2 rounded text-[13px] transition-colors
				{isInvestigationsActive
				? 'bg-vault-surface-raised text-vault-text border border-vault-border'
				: 'text-vault-text-muted hover:text-vault-text hover:bg-vault-surface-raised/50'}"
		>
			<span>All Investigations</span>
		</a>

		<!-- Team placeholder -->
		<div
			class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim px-3 mt-5 mb-2"
		>
			Team
		</div>
		{#if user}
			<div class="flex items-center gap-2 px-3 py-2 text-[13px] text-vault-text-muted">
				<div
					class="w-5 h-5 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center"
				>
					<span class="font-mono text-[8px] text-vault-text-dim">
						{initials(user.display_name)}
					</span>
				</div>
				<span>{user.display_name}</span>
			</div>
		{/if}
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
					<p class="font-mono text-[10px] text-vault-text-dim uppercase">{user.role}</p>
				</div>
			</div>
			<button
				onclick={handleLogout}
				class="text-[11px] text-vault-text-dim hover:text-vault-text transition-colors"
			>
				Sign out
			</button>
		</div>
	{/if}
</aside>
