<script lang="ts">
	import { newsroomAuth, persistSession, getPersistedSession } from '$lib/newsroom/auth';
	import { newsroomApi } from '$lib/newsroom/api';
	import {
		encryptPrivateKeyWithPassword,
		decryptPrivateKeyWithPassword,
		fromBase64,
		toBase64,
		ensureReady
	} from '$lib/crypto';

	const user = $derived($newsroomAuth.user);
	const privateKey = $derived($newsroomAuth.privateKey);

	// Password change state
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let changing = $state(false);
	let changeError = $state('');
	let changeSuccess = $state('');

	// Validation
	const passwordMinLength = 12;
	const passwordsMatch = $derived(newPassword === confirmPassword);
	const passwordLongEnough = $derived(newPassword.length >= passwordMinLength);
	const formValid = $derived(
		currentPassword.length > 0 &&
		passwordLongEnough &&
		passwordsMatch &&
		privateKey !== null
	);

	async function handleChangePassword() {
		if (!formValid || !privateKey) return;

		changing = true;
		changeError = '';
		changeSuccess = '';

		try {
			await ensureReady();

			// Get current encrypted key material from persisted session
			const persisted = getPersistedSession();
			if (!persisted?.encryptedPrivateKey || !persisted?.privateKeyNonce || !persisted?.keySalt) {
				changeError = 'Key material not available. Please log out and log back in.';
				changing = false;
				return;
			}

			// Verify current password by attempting to decrypt the private key
			try {
				await decryptPrivateKeyWithPassword(
					fromBase64(persisted.encryptedPrivateKey),
					fromBase64(persisted.privateKeyNonce),
					fromBase64(persisted.keySalt),
					currentPassword
				);
			} catch {
				changeError = 'Current password is incorrect.';
				changing = false;
				return;
			}

			// Re-encrypt private key with new password
			const { ciphertext, nonce, salt } = await encryptPrivateKeyWithPassword(
				privateKey,
				newPassword
			);

			// Send to server: new password + re-encrypted key material
			await newsroomApi.changePassword({
				current_password: currentPassword,
				new_password: newPassword,
				encrypted_private_key: toBase64(ciphertext),
				private_key_nonce: toBase64(nonce),
				key_salt: toBase64(salt)
			});

			// Update persisted session with new encrypted key material
			if (persisted) {
				persistSession(
					persisted.token,
					persisted.user,
					persisted.expiresAt,
					toBase64(ciphertext),
					toBase64(nonce),
					toBase64(salt),
					persisted.refreshToken,
					persisted.refreshExpiresAt
				);
			}

			// Clear form
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			changeSuccess = 'Password changed successfully.';
		} catch (err) {
			changeError = err instanceof Error ? err.message : 'Failed to change password.';
		} finally {
			changing = false;
		}
	}
</script>

<svelte:head>
	<title>Settings — Scrivault</title>
</svelte:head>

<!-- Header -->
<div class="pl-14 pr-6 md:px-6 py-4 border-b border-vault-border bg-vault-surface shrink-0">
	<h2 class="text-sm font-medium text-vault-text">Settings</h2>
	<p class="text-[11px] text-vault-text-dim mt-0.5">Account and security settings</p>
</div>

<div class="flex-1 overflow-y-auto px-6 py-6">
	<div class="max-w-lg space-y-8">

		<!-- Account info -->
		<section>
			<h3 class="text-[10px] tracking-wide font-medium text-zinc-500 mb-3">
				Account
			</h3>
			<div class="rounded-lg bg-vault-surface border border-vault-border p-4 space-y-3">
				{#if user}
					<div class="flex items-center justify-between">
						<span class="text-xs text-vault-text-muted">Display name</span>
						<span class="text-xs text-vault-text font-mono">{user.display_name}</span>
					</div>
					<div class="w-full h-px bg-vault-border-subtle"></div>
					<div class="flex items-center justify-between">
						<span class="text-xs text-vault-text-muted">Email</span>
						<span class="text-xs text-vault-text font-mono">{user.email}</span>
					</div>
					<div class="w-full h-px bg-vault-border-subtle"></div>
					<div class="flex items-center justify-between">
						<span class="text-xs text-vault-text-muted">Role</span>
						<span class="text-xs text-vault-text capitalize">{user.role === 'reporter' ? 'Reporter' : user.role}</span>
					</div>
					<div class="w-full h-px bg-vault-border-subtle"></div>
					<div class="flex items-center justify-between">
						<span class="text-xs text-vault-text-muted">Encryption keys</span>
						{#if privateKey}
							<span class="inline-flex items-center gap-1 text-[10px] text-vault-green">
								<div class="w-1.5 h-1.5 rounded-full bg-vault-green"></div>
								Active
							</span>
						{:else}
							<span class="inline-flex items-center gap-1 text-[10px] text-vault-amber">
								<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60"></div>
								Not loaded
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<!-- Change password -->
		<section>
			<h3 class="text-[10px] tracking-wide font-medium text-zinc-500 mb-3">
				Change Password
			</h3>
			<div class="rounded-lg bg-vault-surface border border-vault-border p-4">
				{#if !privateKey}
					<div class="flex items-center gap-2 px-3 py-2.5 rounded bg-vault-amber/10 border border-vault-amber/20">
						<div class="w-1.5 h-1.5 rounded-full bg-vault-amber/60 shrink-0"></div>
						<span class="text-xs text-vault-amber">
							Encryption keys are not loaded. Log out and log back in to enable password change.
						</span>
					</div>
				{:else}
					<form
						onsubmit={(e) => { e.preventDefault(); handleChangePassword(); }}
						class="space-y-4"
					>
						<div>
							<label
								for="current-password"
								class="block text-xs text-vault-text-muted mb-1.5"
							>
								Current password
							</label>
							<input
								id="current-password"
								type="password"
								bind:value={currentPassword}
								autocomplete="current-password"
								disabled={changing}
								class="w-full bg-vault-bg border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors disabled:opacity-50"
							/>
						</div>

						<div>
							<label
								for="new-password"
								class="block text-xs text-vault-text-muted mb-1.5"
							>
								New password
							</label>
							<input
								id="new-password"
								type="password"
								bind:value={newPassword}
								autocomplete="new-password"
								disabled={changing}
								class="w-full bg-vault-bg border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors disabled:opacity-50"
							/>
							{#if newPassword && !passwordLongEnough}
								<p class="text-[10px] text-vault-red mt-1">
									Must be at least {passwordMinLength} characters
								</p>
							{/if}
						</div>

						<div>
							<label
								for="confirm-password"
								class="block text-xs text-vault-text-muted mb-1.5"
							>
								Confirm new password
							</label>
							<input
								id="confirm-password"
								type="password"
								bind:value={confirmPassword}
								autocomplete="new-password"
								disabled={changing}
								class="w-full bg-vault-bg border border-vault-border rounded-lg px-3 py-2.5 text-sm text-vault-text placeholder:text-vault-text-dim focus:border-vault-green focus:ring-1 focus:ring-vault-green/50 transition-colors disabled:opacity-50"
							/>
							{#if confirmPassword && !passwordsMatch}
								<p class="text-[10px] text-vault-red mt-1">Passwords do not match</p>
							{/if}
						</div>

						{#if changeError}
							<div class="flex items-center gap-2 px-3 py-2 rounded bg-vault-red-muted border border-vault-red/30">
								<svg class="w-3.5 h-3.5 text-vault-red shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<span class="text-xs text-vault-red">{changeError}</span>
							</div>
						{/if}

						{#if changeSuccess}
							<div class="flex items-center gap-2 px-3 py-2 rounded bg-vault-green-muted border border-vault-green/30">
								<svg class="w-3.5 h-3.5 text-vault-green shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
								</svg>
								<span class="text-xs text-vault-green">{changeSuccess}</span>
							</div>
						{/if}

						<button
							type="submit"
							disabled={!formValid || changing}
							class="w-full flex items-center justify-center gap-2 bg-vault-green hover:bg-vault-green-dim text-black font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
						>
							{#if changing}
								<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								<span>Changing password…</span>
							{:else}
								<span>Change Password</span>
							{/if}
						</button>
					</form>
				{/if}
			</div>
		</section>

		<!-- Security note -->
		<section>
			<div class="rounded-lg bg-vault-surface/50 border border-vault-border-subtle p-4">
				<div class="flex items-start gap-2">
					<svg class="w-4 h-4 text-vault-text-dim shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<div class="space-y-1.5">
						<p class="text-xs text-vault-text-muted">
							Changing your password re-encrypts your private key. Your access to existing threads is preserved.
						</p>
						<p class="text-xs text-vault-text-dim">
							If you lose your password, there is no recovery mechanism. Your encrypted private key cannot be decrypted without it.
						</p>
					</div>
				</div>
			</div>
		</section>
	</div>
</div>
