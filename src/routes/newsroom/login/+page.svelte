<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { setAuth } from '$lib/newsroom/auth';

	let email = $state('');
	let password = $state('');
	let submitting = $state(false);
	let error = $state('');

	async function handleSubmit() {
		if (!email.trim() || !password) return;

		submitting = true;
		error = '';

		try {
			const res = await newsroomApi.login({ email: email.trim(), password });

			setAuth(
				res.token,
				{
					journalist_id: res.journalist_id,
					email: email.trim(),
					display_name: email.trim(),
					role: res.role
				},
				res.expires_at
			);

			goto('/newsroom/tips');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Login failed.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Login — Scrivault Newsroom</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-vault-bg px-4">
	<div class="w-full max-w-sm">
		<!-- Header -->
		<div class="text-center mb-8">
			<h1 class="font-mono text-xs font-semibold tracking-[2px] uppercase text-vault-text">
				Scrivault
			</h1>
			<p class="text-sm text-vault-text-dim mt-2">Newsroom Login</p>
		</div>

		<!-- Form -->
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			autocomplete="off"
			class="space-y-4"
		>
			{#if error}
				<div
					class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-vault-red-muted border border-vault-red/30"
				>
					<span class="text-sm text-vault-red">{error}</span>
				</div>
			{/if}

			<div>
				<label
					for="email"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Email
				</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					required
					autocomplete="email"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="you@newsroom.org"
				/>
			</div>

			<div>
				<label
					for="password"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Password
				</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="Min 12 characters"
				/>
			</div>

			<button
				type="submit"
				disabled={submitting || !email.trim() || !password}
				class="w-full py-2.5 rounded-lg bg-white text-vault-bg text-sm font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
			>
				{submitting ? 'Signing in…' : 'Sign in'}
			</button>
		</form>

		<!-- Register link -->
		<p class="text-center text-[12px] text-vault-text-dim mt-6">
			No account?
			<a
				href="/newsroom/register"
				class="text-vault-text-muted hover:text-vault-text underline underline-offset-2 transition-colors"
			>
				Register
			</a>
		</p>
	</div>
</div>
