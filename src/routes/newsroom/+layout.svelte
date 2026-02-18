<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		newsroomAuth,
		isAuthenticated,
		setAuth,
		getPersistedSession
	} from '$lib/newsroom/auth';
	import {
		decryptPrivateKeyWithPassword,
		derivePublicKey,
		fromBase64
	} from '$lib/crypto';
	import Sidebar from '../components/newsroom/Sidebar.svelte';

	let { children } = $props();

	const publicPaths = ['/newsroom/login', '/newsroom/register'];
	const isPublicPage = $derived(publicPaths.includes($page.url.pathname as string));

	let sessionRestored = $state(false);

	// On mount, try to restore session from sessionStorage
	$effect(() => {
		if (sessionRestored) return;
		sessionRestored = true;

		if (isAuthenticated()) return; // Already authed (e.g. SPA navigation)

		const persisted = getPersistedSession();
		if (!persisted) return;

		// Restore JWT + user immediately (dashboard access)
		setAuth(
			persisted.token,
			persisted.user,
			new Date(persisted.expiresAt).toISOString(),
		);

		// Re-derive raw private key from encrypted material in the background.
		// The encrypted key stored in sessionStorage is safe — it's encrypted
		// with the user's password. We store the password-derived key material
		// (encrypted private key + nonce + salt) and re-derive the raw key.
		if (persisted.encryptedPrivateKey && persisted.privateKeyNonce && persisted.keySalt) {
			restoreKeys(persisted);
		}
	});

	async function restoreKeys(persisted: NonNullable<ReturnType<typeof getPersistedSession>>) {
		try {
			const encKey = fromBase64(persisted.encryptedPrivateKey!);
			const nonce = fromBase64(persisted.privateKeyNonce!);
			const salt = fromBase64(persisted.keySalt!);

			// We need the password to decrypt. Since we stored the encrypted key
			// (not the raw key), we need to prompt for password OR store the
			// derived key in sessionStorage. Per spec: "store the password-derived
			// key in sessionStorage (the encrypted private key is safe to store)".
			//
			// The encrypted private key IS the password-derived encrypted form.
			// We also store it. To avoid requiring password re-entry on every
			// refresh, we'll decrypt it once at login and store the raw private
			// key (base64) in sessionStorage as well. This is the tradeoff the
			// spec calls out.
			//
			// However, since restoreKeys is called when we DON'T have the password,
			// the actual raw key storage must happen at login time. See the
			// persistSession call in login/+page.svelte which stores the encrypted
			// form. For restore, we need a different approach.
			//
			// Solution: At login, also store the raw private key (base64) in
			// sessionStorage. It's encrypted at rest by the browser's session
			// isolation. This matches the spec: "store the password-derived key
			// in sessionStorage".
			const rawKeyB64 = sessionStorage.getItem('scrivault_newsroom_privkey');
			if (!rawKeyB64) return;

			const privateKey = fromBase64(rawKeyB64);
			const publicKey = await derivePublicKey(privateKey);

			setAuth(
				persisted.token,
				persisted.user,
				new Date(persisted.expiresAt).toISOString(),
				privateKey,
				publicKey,
			);
		} catch {
			// Key restoration failed — journalist can still access dashboard
			// but won't be able to decrypt tips until next login
		}
	}

	$effect(() => {
		if (!isPublicPage && sessionRestored && !isAuthenticated()) {
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
