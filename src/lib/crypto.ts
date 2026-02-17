/**
 * Crypto integration layer.
 * Wraps @scrivault/protocol for use in the client.
 * All encryption/decryption happens here — the server never sees plaintext.
 */

import {
	generatePassphrase,
	validatePassphrase,
	deriveKey,
	generateSalt,
	encrypt,
	decrypt,
	encryptString,
	decryptString,
	hashDocumentHex,
	ensureReady
} from '@scrivault/protocol';

export { ensureReady, validatePassphrase };

// ── Types ──────────────────────────────────────────────────────

export interface EncryptedMessage {
	ciphertext: Uint8Array;
	nonce: Uint8Array;
}

export interface ThreadKeys {
	passphrase: string;
	salt: Uint8Array;
	derivedKey: Uint8Array;
}

export interface BlindedIdentity {
	blindedId: string;
	salt: Uint8Array;
}

// ── Passphrase ─────────────────────────────────────────────────

/**
 * Generate a fresh 12-word BIP39 passphrase.
 * This must be called client-side — the passphrase never leaves the browser.
 */
export async function createPassphrase(): Promise<string> {
	await ensureReady();
	return generatePassphrase();
}

// ── Key derivation ─────────────────────────────────────────────

/**
 * Derive the thread encryption key from a passphrase and salt.
 * Uses Argon2id (memory=64MB, iterations=3).
 */
export async function deriveThreadKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
	await ensureReady();
	return deriveKey(passphrase, salt);
}

/**
 * Generate a fresh random salt for key derivation.
 */
export async function createSalt(): Promise<Uint8Array> {
	await ensureReady();
	return generateSalt();
}

// ── Blinded identity ───────────────────────────────────────────

/**
 * Derive a blinded identity from the passphrase.
 * The blinded_id is a deterministic hash of the passphrase — the server
 * uses it to look up the thread without knowing the passphrase.
 */
export async function deriveBlindedId(passphrase: string): Promise<string> {
	await ensureReady();
	const encoder = new TextEncoder();
	return hashDocumentHex(encoder.encode(passphrase));
}

// ── Full key setup (new thread) ────────────────────────────────

/**
 * Generate everything needed for a new tip submission:
 * passphrase, salt, derived key, and blinded identity.
 */
export async function createThreadKeys(): Promise<ThreadKeys & { blindedId: string }> {
	await ensureReady();
	const passphrase = await createPassphrase();
	const salt = await createSalt();
	const derivedKey = await deriveThreadKey(passphrase, salt);
	const blindedId = await deriveBlindedId(passphrase);
	return { passphrase, salt, derivedKey, blindedId };
}

/**
 * Recover thread keys from an existing passphrase + salt.
 */
export async function recoverThreadKeys(passphrase: string, salt: Uint8Array): Promise<ThreadKeys & { blindedId: string }> {
	await ensureReady();
	const derivedKey = await deriveThreadKey(passphrase, salt);
	const blindedId = await deriveBlindedId(passphrase);
	return { passphrase, salt, derivedKey, blindedId };
}

// ── Message encryption ─────────────────────────────────────────

/**
 * Encrypt a plaintext message string with the thread key.
 */
export async function encryptMessage(plaintext: string, key: Uint8Array): Promise<EncryptedMessage> {
	await ensureReady();
	const result = await encryptString(plaintext, key);
	return { ciphertext: result.ciphertext, nonce: result.nonce };
}

/**
 * Decrypt a ciphertext message back to plaintext string.
 */
export async function decryptMessage(
	ciphertext: Uint8Array,
	nonce: Uint8Array,
	key: Uint8Array
): Promise<string> {
	await ensureReady();
	return decryptString(ciphertext, nonce, key);
}

// ── File encryption ────────────────────────────────────────────

/**
 * Encrypt raw file bytes with the thread key.
 */
export async function encryptFile(data: Uint8Array, key: Uint8Array): Promise<EncryptedMessage> {
	await ensureReady();
	const result = await encrypt(data, key);
	return { ciphertext: result.ciphertext, nonce: result.nonce };
}

/**
 * Decrypt file ciphertext back to raw bytes.
 */
export async function decryptFile(
	ciphertext: Uint8Array,
	nonce: Uint8Array,
	key: Uint8Array
): Promise<Uint8Array> {
	await ensureReady();
	return decrypt(ciphertext, nonce, key);
}

// ── Hashing ────────────────────────────────────────────────────

/**
 * Hash a file/document and return hex string.
 * Used for integrity verification before encryption.
 */
export async function hashFile(data: Uint8Array): Promise<string> {
	return hashDocumentHex(data);
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Re-export base64 helpers from api.ts.
 * Go's encoding/json serializes []byte as base64 strings,
 * so all byte fields must be base64-encoded for the API.
 */
export { toBase64, fromBase64 } from '$lib/api';
