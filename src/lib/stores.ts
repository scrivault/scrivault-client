/**
 * Client-side stores for ephemeral session state.
 * Thread keys live only in memory — never persisted to localStorage/cookies.
 */

import { writable } from 'svelte/store';

/** The current thread's derived key (in-memory only). */
export const threadKey = writable<Uint8Array | null>(null);

/** The current thread's blinded ID (used as threadId in API calls). */
export const threadId = writable<string | null>(null);

/** The current thread's salt. */
export const threadSalt = writable<Uint8Array | null>(null);

/** The passphrase shown after submission (cleared after user confirms). */
export const pendingPassphrase = writable<string | null>(null);

/** Clear all session state. */
export function clearSession(): void {
	threadKey.set(null);
	threadId.set(null);
	threadSalt.set(null);
	pendingPassphrase.set(null);
}
