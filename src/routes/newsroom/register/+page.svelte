<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { setAuth } from '$lib/newsroom/auth';

	let email = $state('');
	let displayName = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let error = $state('');

	const passwordsMatch = $derived(password === confirmPassword);
	const passwordLongEnough = $derived(password.length >= 12);
	const canSubmit = $derived(
		email.trim() && displayName.trim() && passwordLongEnough && passwordsMatch && !submitting
	);

	async function handleSubmit() {
		if (!canSubmit) return;

		submitting = true;
		error = '';

		try {
			await newsroomApi.register({
				email: email.trim(),
				password,
				display_name: displayName.trim()
			});

			// Auto-login after registration
			const loginRes = await newsroomApi.login({
				email: email.trim(),
				password
			});

			setAuth(
				loginRes.token,
				{
					journalist_id: loginRes.journalist_id,
					email: email.trim(),
					display_name: displayName.trim(),
					role: loginRes.role
				},
				loginRes.expires_at
			);

			goto('/newsroom/tips');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Registration failed.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Register — Scrivault Newsroom</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-vault-bg px-4">
	<div class="w-full max-w-sm">
		<!-- Header -->
		<div class="text-center mb-8">
			<h1 class="font-mono text-xs font-semibold tracking-[2px] uppercase text-vault-text">
				Scrivault
			</h1>
			<p class="text-sm text-vault-text-dim mt-2">Create Account</p>
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
					for="display-name"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Display Name
				</label>
				<input
					id="display-name"
					type="text"
					bind:value={displayName}
					required
					autocomplete="name"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="Your name"
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
					autocomplete="new-password"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="Min 12 characters"
				/>
				{#if password && !passwordLongEnough}
					<p class="text-[11px] text-vault-amber mt-1">Minimum 12 characters required</p>
				{/if}
			</div>

			<div>
				<label
					for="confirm-password"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Confirm Password
				</label>
				<input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					required
					autocomplete="new-password"
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="Repeat password"
				/>
				{#if confirmPassword && !passwordsMatch}
					<p class="text-[11px] text-vault-red mt-1">Passwords do not match</p>
				{/if}
			</div>

			<button
				type="submit"
				disabled={!canSubmit}
				class="w-full py-2.5 rounded-lg bg-white text-vault-bg text-sm font-medium transition-colors hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
			>
				{submitting ? 'Creating account…' : 'Create account'}
			</button>
		</form>

		<!-- Login link -->
		<p class="text-center text-[12px] text-vault-text-dim mt-6">
			Already have an account?
			<a
				href="/newsroom/login"
				class="text-vault-text-muted hover:text-vault-text underline underline-offset-2 transition-colors"
			>
				Sign in
			</a>
		</p>
	</div>
</div>
