/**
 * Newsroom authentication store.
 *
 * JWT, user info, and the encrypted private key material are persisted
 * to sessionStorage so journalists survive page refreshes. The raw
 * private key is re-derived from the encrypted material on restore.
 *
 * Source-side auth remains memory-only (no persistence).
 */

import { writable, get } from 'svelte/store';

export interface NewsroomUser {
	journalist_id: string;
	email: string;
	display_name: string;
	role: 'editor' | 'reporter';
}

export interface AuthState {
	token: string | null;
	user: NewsroomUser | null;
	expiresAt: number | null; // Unix ms
	privateKey: Uint8Array | null; // X25519 private key (in-memory only)
	publicKey: Uint8Array | null; // X25519 public key (in-memory only)
}

/**
 * Shape of what we persist to sessionStorage.
 * The encrypted private key is safe to store — it's encrypted with the user's
 * password via Argon2id + XChaCha20-Poly1305. The raw key never touches storage.
 */
interface PersistedSession {
	token: string;
	user: NewsroomUser;
	expiresAt: number;
	encryptedPrivateKey: string | null; // base64
	privateKeyNonce: string | null; // base64
	keySalt: string | null; // base64
}

const SESSION_KEY = 'scrivault_newsroom_session';

export const newsroomAuth = writable<AuthState>({
	token: null,
	user: null,
	expiresAt: null,
	privateKey: null,
	publicKey: null
});

/** Set auth state after login. Optionally includes decrypted keypair. */
export function setAuth(
	token: string,
	user: NewsroomUser,
	expiresAt: string,
	privateKey?: Uint8Array | null,
	publicKey?: Uint8Array | null,
): void {
	newsroomAuth.set({
		token,
		user,
		expiresAt: new Date(expiresAt).getTime(),
		privateKey: privateKey ?? null,
		publicKey: publicKey ?? null
	});
}

/**
 * Persist session to sessionStorage.
 * Stores the JWT, user info, expiry, and the *encrypted* private key material
 * (not the raw key). Called after successful login.
 */
export function persistSession(
	token: string,
	user: NewsroomUser,
	expiresAt: number,
	encryptedPrivateKey: string | null,
	privateKeyNonce: string | null,
	keySalt: string | null,
): void {
	try {
		const data: PersistedSession = {
			token,
			user,
			expiresAt,
			encryptedPrivateKey,
			privateKeyNonce,
			keySalt,
		};
		sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
	} catch {
		// sessionStorage unavailable (private browsing, etc.) — degrade silently
	}
}

/**
 * Try to restore session from sessionStorage.
 * Returns the persisted data if valid and not expired, or null.
 * Does NOT set the store — the caller must decrypt keys first and then call setAuth.
 */
export function getPersistedSession(): PersistedSession | null {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		if (!raw) return null;
		const data: PersistedSession = JSON.parse(raw);
		// Check expiry (with 30s buffer)
		if (!data.token || !data.expiresAt || Date.now() >= data.expiresAt - 30_000) {
			sessionStorage.removeItem(SESSION_KEY);
			return null;
		}
		return data;
	} catch {
		return null;
	}
}

/** Clear auth state (logout). Wipes key material from memory and sessionStorage. */
export function clearAuth(): void {
	newsroomAuth.set({
		token: null,
		user: null,
		expiresAt: null,
		privateKey: null,
		publicKey: null
	});
	try {
		sessionStorage.removeItem(SESSION_KEY);
		sessionStorage.removeItem('scrivault_newsroom_privkey');
	} catch {
		// Ignore
	}
}

/** Check if the stored token is still valid. */
export function isAuthenticated(): boolean {
	const state = get(newsroomAuth);
	if (!state.token || !state.expiresAt) return false;
	return Date.now() < state.expiresAt - 30_000;
}

/** Get the current token or null if expired. */
export function getToken(): string | null {
	if (!isAuthenticated()) return null;
	return get(newsroomAuth).token;
}
