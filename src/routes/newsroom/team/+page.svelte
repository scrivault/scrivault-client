<script lang="ts">
	import { onMount } from 'svelte';
	import { newsroomApi } from '$lib/newsroom/api';
	import { newsroomAuth } from '$lib/newsroom/auth';
	import type { InviteResponse } from '$lib/newsroom/types';

	let inviteEmail = $state('');
	let inviteRole = $state<'editor' | 'reporter'>('reporter');
	let inviting = $state(false);
	let inviteError = $state('');
	let inviteSuccess = $state('');

	let invites = $state<InviteResponse[]>([]);
	let loadingInvites = $state(true);
	let revoking = $state<string | null>(null);

	// Tokens from invites created in this session (the list endpoint doesn't return tokens)
	let tokenMap = $state<Record<string, string>>({});
	let copiedId = $state<string | null>(null);

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

	function buildInviteLink(token: string): string {
		return `${window.location.origin}/newsroom/register?token=${token}`;
	}

	function getToken(invite: InviteResponse): string | undefined {
		return invite.token ?? tokenMap[invite.id];
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

	onMount(() => {
		loadInvites();
	});
</script>

<svelte:head>
	<title>Team — Scrivault Newsroom</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<!-- Header -->
		<div>
			<h1 class="text-lg font-semibold text-vault-text">Team</h1>
			<p class="text-sm text-vault-text-muted mt-1">Manage your newsroom team members.</p>
		</div>

		<!-- Current user -->
		<section>
			<h2
				class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim mb-3"
			>
				Your Account
			</h2>
			{#if user}
				<div
					class="flex items-center gap-3 p-4 rounded-lg bg-vault-surface border border-vault-border"
				>
					<div
						class="w-9 h-9 rounded-full bg-vault-surface-raised border border-vault-border flex items-center justify-center"
					>
						<span class="font-mono text-xs text-vault-text-dim">
							{initials(user.display_name)}
						</span>
					</div>
					<div class="min-w-0">
						<p class="text-sm text-vault-text">{user.display_name}</p>
						<p class="font-mono text-[10px] text-vault-text-dim uppercase">
							{user.role} &middot; {user.email}
						</p>
					</div>
				</div>
			{/if}
		</section>

		<!-- Invite section (editor-only) -->
		{#if isEditor}
			<section>
				<h2
					class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim mb-3"
				>
					Invite Journalist
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
							class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
						>
							Email
						</label>
						<input
							id="invite-email"
							type="email"
							bind:value={inviteEmail}
							required
							class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
							placeholder="journalist@newsroom.org"
						/>
					</div>
					<div class="w-32">
						<label
							for="invite-role"
							class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
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
					class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim mb-3"
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
									<p class="font-mono text-[10px] text-vault-text-dim uppercase">
										{invite.role} &middot; expires {new Date(invite.expires_at).toLocaleDateString()}
									</p>
								</div>
								<div class="flex items-center gap-2 ml-3">
									{#if getToken(invite)}
										<button
											onclick={() => copyLink(invite)}
											class="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors
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
										class="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider text-vault-red bg-vault-red-muted border border-vault-red/30 hover:bg-vault-red/20 transition-colors disabled:opacity-50"
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
					Only editors can manage team invitations.
				</p>
			</div>
		{/if}
	</div>
</div>
