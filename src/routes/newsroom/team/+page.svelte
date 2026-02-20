<script lang="ts">
	import { onMount } from 'svelte';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import type { InviteResponse, TeamMember } from '$lib/newsroom/types';

	let inviteEmail = $state('');
	let inviteRole = $state<'editor' | 'reporter'>('reporter');
	let inviting = $state(false);
	let inviteError = $state('');
	let inviteSuccess = $state('');

	let invites = $state<InviteResponse[]>([]);
	let loadingInvites = $state(true);
	let revoking = $state<string | null>(null);

	// Team members
	let members = $state<TeamMember[]>([]);
	let loadingMembers = $state(true);

	// Tokens from invites created in this session (the list endpoint doesn't return tokens)
	let tokenMap = $state<Record<string, string>>({});
	let copiedId = $state<string | null>(null);
	let deactivatingId = $state<string | null>(null);

	const user = $derived($newsroomAuth.user);
	const isEditor = $derived(user?.role === 'editor');

	function initials(name: string): string {
		return name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function buildInviteLink(token: string): string {
		return `${window.location.origin}/newsroom/register?token=${token}`;
	}

	function getToken(invite: InviteResponse): string | undefined {
		return invite.token ?? tokenMap[invite.id];
	}

	async function loadTeamMembers() {
		loadingMembers = true;
		try {
			const res = await newsroomApi.getTeamMembers();
			members = res.members ?? [];
		} catch {
			members = [];
		} finally {
			loadingMembers = false;
		}
	}

	async function loadInvites() {
		if (!isEditor) return;
		try {
			const res = await newsroomApi.getInvites();
			invites = res.invites ?? [];
		} catch {
			// Silently fail — invites section just stays empty
		} finally {
			loadingInvites = false;
		}
	}

	async function handleInvite() {
		if (!inviteEmail.trim() || inviting) return;

		inviting = true;
		inviteError = '';
		inviteSuccess = '';

		try {
			const res = await newsroomApi.createInvite({
				email: inviteEmail.trim(),
				role: inviteRole
			});

			if (res.token) {
				// Store the token locally so copy-link works after list reload
				tokenMap[res.id] = res.token;
				const link = buildInviteLink(res.token);
				await navigator.clipboard.writeText(link);
				inviteSuccess = 'Invite created. Link copied to clipboard.';
			} else {
				inviteSuccess = 'Invite created.';
			}

			inviteEmail = '';
			await loadInvites();
		} catch (err) {
			inviteError = err instanceof Error ? err.message : 'Failed to create invite.';
		} finally {
			inviting = false;
		}
	}

	async function handleRevoke(id: string) {
		revoking = id;
		try {
			await newsroomApi.revokeInvite(id);
			invites = invites.filter((inv) => inv.id !== id);
			delete tokenMap[id];
		} catch {
			// Ignore — invite may already be revoked
		} finally {
			revoking = null;
		}
	}

	async function copyLink(invite: InviteResponse) {
		const token = getToken(invite);
		if (!token) return;
		const link = buildInviteLink(token);
		await navigator.clipboard.writeText(link);
		copiedId = invite.id;
		setTimeout(() => {
			if (copiedId === invite.id) copiedId = null;
		}, 2000);
	}

	async function handleDeactivate(member: TeamMember) {
		if (!confirm(`Deactivate ${member.display_name}? This will revoke all their decryption keys.`)) return;
		deactivatingId = member.id;
		try {
			await newsroomApi.deactivateTeamMember(member.id);
			await loadTeamMembers();
		} catch {
			// Ignore
		} finally {
			deactivatingId = null;
		}
	}

	onMount(() => {
		loadTeamMembers();
		loadInvites();
	});
</script>

<svelte:head>
	<title>Team — Scrivault</title>
</svelte:head>

<div class="flex-1 overflow-y-auto pl-14 pr-6 py-6 md:p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<!-- Header -->
		<div>
			<h1 class="text-lg font-semibold text-vault-text">Team</h1>
			<p class="text-sm text-vault-text-muted mt-1">Manage your team members.</p>
		</div>

		<!-- Team members list -->
		<section>
			<h2
				class="text-[10px] tracking-wide font-medium text-zinc-500 mb-3"
			>
				Members
			</h2>

			{#if loadingMembers}
				<div class="flex items-center gap-2 py-6 justify-center">
					<svg class="w-4 h-4 animate-spin text-vault-text-dim" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="text-sm text-vault-text-dim">Loading team…</span>
				</div>
			{:else if members.length === 0}
				<div class="p-4 rounded-lg bg-vault-surface border border-vault-border text-center">
					<p class="text-sm text-vault-text-dim">No team members found.</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each members as member (member.id)}
						{@const isMe = user && member.id === user.journalist_id}
						<div
							class="flex items-center justify-between p-4 rounded-lg bg-vault-surface border border-vault-border"
						>
							<div class="flex items-center gap-3 min-w-0">
								<div
									class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center
										{isMe
										? 'bg-vault-green-muted border border-vault-green/30'
										: 'bg-vault-surface-raised border border-vault-border'}"
								>
									<span class="text-xs {isMe ? 'text-vault-green' : 'text-vault-text-dim'}">
										{initials(member.display_name)}
									</span>
								</div>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<p class="text-sm text-vault-text truncate">{member.display_name}</p>
										{#if isMe}
											<span class="font-mono text-[9px] text-vault-green">(you)</span>
										{/if}
									</div>
									<p class="font-mono text-[10px] text-vault-text-dim truncate">
										{member.email}
									</p>
								</div>
							</div>
							<div class="flex items-center gap-3 ml-3 shrink-0">
								<span class="text-[11px] text-vault-text-muted capitalize">{member.role === 'reporter' ? 'Reporter' : member.role}</span>
								<span class="text-[10px] text-vault-text-dim">
									{formatDate(member.created_at)}
								</span>
								{#if isEditor && !isMe}
									<button
										onclick={() => handleDeactivate(member)}
										disabled={deactivatingId === member.id}
										class="text-[11px] text-vault-text-dim hover:text-vault-red transition-colors disabled:opacity-50"
									>
										{deactivatingId === member.id ? 'Deactivating…' : 'Deactivate'}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Invite section (editor-only) -->
		{#if isEditor}
			<section>
				<h2
					class="text-[10px] tracking-wide font-medium text-zinc-500 mb-3"
				>
					Invite Team Member
				</h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleInvite();
					}}
					class="flex items-end gap-3"
				>
					<div class="flex-1">
						<label
							for="invite-email"
							class="block text-[10px] tracking-wide font-medium text-zinc-500 mb-1.5"
						>
							Email
						</label>
						<input
							id="invite-email"
							type="email"
							bind:value={inviteEmail}
							required
							class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
							placeholder="name@yourorg.com"
						/>
					</div>
					<div class="w-32">
						<label
							for="invite-role"
							class="block text-[10px] tracking-wide font-medium text-zinc-500 mb-1.5"
						>
							Role
						</label>
						<select
							id="invite-role"
							bind:value={inviteRole}
							class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
						>
							<option value="reporter">Reporter</option>
							<option value="editor">Editor</option>
						</select>
					</div>
					<button
						type="submit"
						disabled={inviting || !inviteEmail.trim()}
						class="shrink-0 px-4 py-2.5 rounded-lg bg-vault-green text-black text-sm font-semibold transition-colors hover:bg-vault-green-dim disabled:opacity-30 disabled:cursor-not-allowed"
					>
						{inviting ? 'Sending…' : 'Send Invite'}
					</button>
				</form>

				{#if inviteError}
					<div
						class="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-red-muted border border-vault-red/30"
					>
						<span class="text-sm text-vault-red">{inviteError}</span>
					</div>
				{/if}

				{#if inviteSuccess}
					<div
						class="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-green-muted border border-vault-green/30"
					>
						<span class="text-sm text-vault-green">{inviteSuccess}</span>
					</div>
				{/if}
			</section>

			<!-- Pending invites -->
			<section>
				<h2
					class="text-[10px] tracking-wide font-medium text-zinc-500 mb-3"
				>
					Pending Invites
				</h2>

				{#if loadingInvites}
					<p class="text-sm text-vault-text-dim">Loading…</p>
				{:else if invites.length === 0}
					<div
						class="p-4 rounded-lg bg-vault-surface border border-vault-border text-center"
					>
						<p class="text-sm text-vault-text-dim">No pending invites.</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each invites as invite (invite.id)}
							<div
								class="flex items-center justify-between p-3 rounded-lg bg-vault-surface border border-vault-border"
							>
								<div class="min-w-0 flex-1">
									<p class="text-sm text-vault-text truncate">{invite.email}</p>
									<p class="text-[10px] text-vault-text-dim capitalize">
										{invite.role} &middot; expires {new Date(invite.expires_at).toLocaleDateString()}
									</p>
								</div>
								<div class="flex items-center gap-2 ml-3">
									{#if getToken(invite)}
										<button
											onclick={() => copyLink(invite)}
											class="px-3 py-1.5 rounded text-[11px] transition-colors
												{copiedId === invite.id
												? 'text-vault-green bg-vault-green-muted border border-vault-green/30'
												: 'text-vault-text-muted bg-vault-surface-raised border border-vault-border hover:text-vault-text'}"
										>
											{copiedId === invite.id ? 'Copied' : 'Copy Link'}
										</button>
									{/if}
									<button
										onclick={() => handleRevoke(invite.id)}
										disabled={revoking === invite.id}
										class="px-3 py-1.5 rounded text-[11px] text-vault-red bg-vault-red-muted border border-vault-red/30 hover:bg-vault-red/20 transition-colors disabled:opacity-50"
									>
										{revoking === invite.id ? 'Revoking…' : 'Revoke'}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{:else}
			<div class="p-4 rounded-lg bg-vault-surface border border-vault-border text-center">
				<p class="text-sm text-vault-text-dim">
					Only editors can manage the team.
				</p>
			</div>
		{/if}
	</div>
</div>
