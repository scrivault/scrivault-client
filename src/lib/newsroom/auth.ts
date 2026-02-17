/**
 * Newsroom authentication store.
 * JWT and user info live in memory only — never persisted.
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

/** Clear auth state (logout). Wipes key material from memory. */
export function clearAuth(): void {
	newsroomAuth.set({
		token: null,
		user: null,
		expiresAt: null,
		privateKey: null,
		publicKey: null
	});
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
