/**
 * Typed API client for the Scrivault Go server.
 * All endpoints proxy through Vite dev server to localhost:8080.
 *
 * IMPORTANT: Go's encoding/json serializes []byte as base64 strings,
 * not JSON arrays. All byte fields use base64 encoding over the wire.
 */

const BASE = '/api';

// ── Base64 helpers ─────────────────────────────────────────────

/** Encode Uint8Array to base64 string for Go []byte JSON fields. */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/** Decode base64 string from Go []byte JSON fields to Uint8Array. */
export function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// ── Request types (what we send — base64 encoded) ──────────────

export interface KeyGrantPayload {
	journalist_id: string;
	sealed_key: string; // base64
}

export interface CreateTipRequest {
	blinded_id: string;
	ciphertext: string; // base64
	nonce: string;      // base64
	salt: string;       // base64
	sender_role?: 'source' | 'journalist';
	key_grants?: KeyGrantPayload[];
}

export interface AddMessageRequest {
	ciphertext: string; // base64
	nonce: string;      // base64
	sender_role?: 'source' | 'journalist';
}

export interface UploadDocumentRequest {
	ciphertext: string;      // base64
	nonce: string;           // base64
	sha256_hash: string;
	file_size: number;
	encrypted_name?: string; // base64
	name_nonce?: string;     // base64
}

// ── Response types (what Go sends back — base64 encoded) ───────

export interface ErrorResponse {
	error: string;
	code?: string;
}

export interface CreateTipResponse {
	thread_id: string;
	message_id: string;
	created_at: string;
}

export interface MessagePayload {
	id: string;
	ciphertext: string; // base64
	nonce: string;      // base64
	sender_role: 'source' | 'journalist';
	ordinal: number;
	created_at: string;
}

export interface GetTipResponse {
	thread_id: string;
	salt: string; // base64
	messages: MessagePayload[];
	created_at: string;
}

export interface AddMessageResponse {
	message_id: string;
	ordinal: number;
	created_at: string;
}

export interface UploadDocumentResponse {
	document_id: string;
	sha256_hash: string;
	created_at: string;
}

export interface GetDocumentResponse {
	id: string;
	thread_id: string;
	ciphertext: string; // base64
	nonce: string;      // base64
	sha256_hash: string;
	file_size: number;
	encrypted_name?: string; // base64
	name_nonce?: string;     // base64
	created_at: string;
}

export interface ProvenanceEntry {
	id: string;
	sequence_num: number;
	event_type: string;
	event_data: Record<string, unknown>;
	entry_hash: string;
	prev_hash: string;
	created_at: string;
}

export interface GetProvenanceResponse {
	thread_id: string;
	entries: ProvenanceEntry[];
}

export interface HealthResponse {
	status: string;
	database: string;
}

// ── API error ──────────────────────────────────────────────────

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

// ── Fetch wrapper ──────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers
		}
	});

	const body = await res.json();

	if (!res.ok) {
		const err = body as ErrorResponse;
		throw new ApiError(res.status, err.code ?? 'unknown', err.error);
	}

	return body as T;
}

// ── Authenticated fetch wrapper ─────────────────────────────────

/** Injects Authorization: Bearer header. Used by newsroom endpoints. */
export async function authRequest<T>(
	path: string,
	token: string,
	options?: RequestInit
): Promise<T> {
	return request<T>(path, {
		...options,
		headers: {
			...options?.headers,
			Authorization: `Bearer ${token}`
		}
	});
}

// ── Endpoints ──────────────────────────────────────────────────

export const api = {
	health(): Promise<HealthResponse> {
		return request<HealthResponse>('/healthz'.replace('/api', ''));
	},

	createTip(req: CreateTipRequest): Promise<CreateTipResponse> {
		return request<CreateTipResponse>('/tips', {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	getTip(threadId: string): Promise<GetTipResponse> {
		return request<GetTipResponse>(`/tips/${encodeURIComponent(threadId)}`);
	},

	addMessage(threadId: string, req: AddMessageRequest): Promise<AddMessageResponse> {
		return request<AddMessageResponse>(`/tips/${encodeURIComponent(threadId)}/messages`, {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	uploadDocument(threadId: string, req: UploadDocumentRequest): Promise<UploadDocumentResponse> {
		return request<UploadDocumentResponse>(
			`/tips/${encodeURIComponent(threadId)}/documents`,
			{
				method: 'POST',
				body: JSON.stringify(req)
			}
		);
	},

	getDocument(docId: string): Promise<GetDocumentResponse> {
		return request<GetDocumentResponse>(`/documents/${encodeURIComponent(docId)}`);
	},

	getProvenance(threadId: string): Promise<GetProvenanceResponse> {
		return request<GetProvenanceResponse>(`/provenance/${encodeURIComponent(threadId)}`);
	}
};
