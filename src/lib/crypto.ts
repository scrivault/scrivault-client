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
	ensureReady,
	// Key exchange primitives
	generateKeypair,
	publicKeyFromPrivate,
	sealForRecipient,
	unsealWithKeypair,
	encryptPrivateKey as protoEncryptPrivateKey,
	decryptPrivateKey as protoDecryptPrivateKey,
} from '@scrivault/protocol';
import type { Keypair } from '@scrivault/protocol';

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

// ── Key exchange (Bitwarden-style) ────────────────────────────

export type { Keypair };

/**
 * Generate a fresh X25519 keypair for sealed-box key exchange.
 * Called during journalist registration.
 */
export async function generateJournalistKeypair(): Promise<Keypair> {
	await ensureReady();
	return generateKeypair();
}

/**
 * Encrypt a journalist's private key with their password.
 * Uses Argon2id to derive a key from the password, then XChaCha20-Poly1305.
 * Returns ciphertext, nonce, and the salt used for Argon2id.
 */
export async function encryptPrivateKeyWithPassword(
	privateKey: Uint8Array,
	password: string,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array; salt: Uint8Array }> {
	await ensureReady();
	const salt = await createSalt();
	const passwordKey = await deriveThreadKey(password, salt);
	const { ciphertext, nonce } = await protoEncryptPrivateKey(privateKey, passwordKey);
	return { ciphertext, nonce, salt };
}

/**
 * Decrypt a journalist's private key from encrypted storage.
 * Derives the password key via Argon2id, then decrypts with XChaCha20-Poly1305.
 */
export async function decryptPrivateKeyWithPassword(
	ciphertext: Uint8Array,
	nonce: Uint8Array,
	salt: Uint8Array,
	password: string,
): Promise<Uint8Array> {
	await ensureReady();
	const passwordKey = await deriveThreadKey(password, salt);
	return protoDecryptPrivateKey(ciphertext, nonce, passwordKey);
}

/**
 * Seal a symmetric thread key for a journalist using their X25519 public key.
 * Used by sources (seal for editors) and editors (re-seal for reporters).
 */
export async function sealThreadKeyForJournalist(
	threadKey: Uint8Array,
	recipientPubKey: Uint8Array,
): Promise<Uint8Array> {
	await ensureReady();
	return sealForRecipient(threadKey, recipientPubKey);
}

/**
 * Unseal a thread key from a sealed box using the journalist's keypair.
 * Returns the 32-byte symmetric thread key.
 */
export async function unsealThreadKey(
	sealed: Uint8Array,
	publicKey: Uint8Array,
	privateKey: Uint8Array,
): Promise<Uint8Array> {
	await ensureReady();
	return unsealWithKeypair(sealed, publicKey, privateKey);
}

/**
 * Derive the X25519 public key from a private key.
 * Used after login to reconstruct the public key from the decrypted private key.
 */
export async function derivePublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
	await ensureReady();
	return publicKeyFromPrivate(privateKey);
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Re-export base64 helpers from api.ts.
 * Go's encoding/json serializes []byte as base64 strings,
 * so all byte fields must be base64-encoded for the API.
 */
export { toBase64, fromBase64 } from '$lib/api';
