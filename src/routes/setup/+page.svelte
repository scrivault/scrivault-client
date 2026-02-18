<script lang="ts">
	import { goto } from '$app/navigation';
	import { newsroomApi } from '$lib/newsroom/api';
	import { setAuth } from '$lib/newsroom/auth';
	import { orgStore } from '$lib/newsroom/org';
	import {
		generateJournalistKeypair,
		encryptPrivateKeyWithPassword,
		toBase64
	} from '$lib/crypto';
	import { ApiError } from '$lib/api';

	let orgName = $state('');
	let orgSlug = $state('');
	let slugEdited = $state(false);
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let statusText = $state('');
	let error = $state('');

	const passwordsMatch = $derived(password === confirmPassword);
	const passwordLongEnough = $derived(password.length >= 12);
	const canSubmit = $derived(
		orgName.trim() &&
			orgSlug.trim() &&
			displayName.trim() &&
			email.trim() &&
			passwordLongEnough &&
			passwordsMatch &&
			!submitting
	);

	function generateSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	function handleOrgNameInput() {
		if (!slugEdited) {
			orgSlug = generateSlug(orgName);
		}
	}

	function handleSlugInput() {
		slugEdited = true;
		orgSlug = generateSlug(orgSlug);
	}

	async function handleSubmit() {
		if (!canSubmit) return;

		submitting = true;
		error = '';

		try {
			statusText = 'Generating encryption keys…';
			const keypair = await generateJournalistKeypair();
			const encKey = await encryptPrivateKeyWithPassword(keypair.privateKey, password);

			statusText = 'Setting up organization…';
			const res = await newsroomApi.setup({
				org_name: orgName.trim(),
				org_slug: orgSlug.trim(),
				admin_email: email.trim(),
				admin_display_name: displayName.trim(),
				admin_password: password,
				public_key: toBase64(keypair.publicKey),
				encrypted_private_key: toBase64(encKey.ciphertext),
				private_key_nonce: toBase64(encKey.nonce),
				key_salt: toBase64(encKey.salt)
			});

			// Auto-login with locally generated keypair (no extra login call needed)
			setAuth(
				res.token,
				{
					journalist_id: res.journalist_id,
					email: email.trim(),
					display_name: displayName.trim(),
					role: 'editor'
				},
				res.expires_at,
				keypair.privateKey,
				keypair.publicKey
			);

			// Set org store
			orgStore.set(res.organization);

			goto('/newsroom/tips');
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				// Org already exists — redirect to login
				goto('/newsroom/login');
				return;
			}
			error = err instanceof Error ? err.message : 'Setup failed.';
		} finally {
			submitting = false;
			statusText = '';
		}
	}
</script>

<svelte:head>
	<title>Set Up Scrivault</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-vault-bg px-4 py-12">
	<div class="w-full max-w-sm">
		<!-- Header -->
		<div class="text-center mb-8">
			<div class="inline-flex items-center gap-2 mb-4">
				<div class="w-8 h-8 rounded bg-vault-green/20 flex items-center justify-center">
					<svg
						class="w-4 h-4 text-vault-green"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
				</div>
				<span class="font-mono text-sm text-vault-text-muted tracking-wider uppercase"
					>Scrivault</span
				>
			</div>
			<h1 class="text-xl font-semibold text-vault-text mb-1">First-Time Setup</h1>
			<p class="text-sm text-vault-text-dim">
				Configure your organization and create the first editor account.
			</p>
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

			<!-- Organization section -->
			<div
				class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim mt-2 mb-1"
			>
				Organization
			</div>

			<div>
				<label
					for="org-name"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Organization Name
				</label>
				<input
					id="org-name"
					type="text"
					bind:value={orgName}
					oninput={handleOrgNameInput}
					required
					class="w-full bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors"
					placeholder="Pacific Ledger"
				/>
			</div>

			<div>
				<label
					for="org-slug"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Your Tip Page URL
				</label>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex items-center bg-vault-surface border border-vault-border rounded-lg px-3 py-2.5 focus-within:border-vault-green focus-within:ring-1 focus-within:ring-vault-green/50 transition-colors cursor-text"
					onclick={() => document.getElementById('org-slug')?.focus()}
				>
					<span class="text-sm font-mono text-vault-text-dim select-none whitespace-nowrap"
						>https://</span
					>
					<input
						id="org-slug"
						type="text"
						bind:value={orgSlug}
						oninput={handleSlugInput}
						required
						style="width: {Math.max(orgSlug.length, 1)}ch"
						class="bg-transparent border-none outline-none text-sm font-mono text-vault-green placeholder:text-vault-text-dim min-w-[3ch] p-0"
						placeholder="xxx"
					/>
					<span class="text-sm font-mono text-vault-text-dim select-none whitespace-nowrap"
						>.scrivault.org</span
					>
				</div>
			</div>

			<!-- Admin account section -->
			<div
				class="font-mono text-[9px] tracking-[2px] uppercase text-vault-text-dim mt-6 mb-1"
			>
				Editor Account
			</div>

			<div>
				<label
					for="display-name"
					class="block font-mono text-[10px] tracking-wider uppercase text-vault-text-dim mb-1.5"
				>
					Your Name
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
				class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-vault-green text-black text-sm font-semibold transition-colors hover:bg-vault-green-dim disabled:opacity-30 disabled:cursor-not-allowed"
			>
				{#if submitting}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
					<span>{statusText || 'Setting up…'}</span>
				{:else}
					<span>Set Up Scrivault</span>
				{/if}
			</button>
		</form>
	</div>
</div>
