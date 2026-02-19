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

// ── User-friendly error mapping ────────────────────────────────

const ERROR_MESSAGES: Record<number, Record<string, string>> = {
	401: {
		unauthorized: 'Your session has expired — please log in again',
		_default: 'Authentication required — please log in'
	},
	403: {
		forbidden: "You don't have permission to perform this action",
		_default: 'Access denied'
	},
	404: {
		_default: 'The requested resource was not found'
	},
	409: {
		conflict: 'This resource already exists',
		_default: 'A conflict occurred — please try again'
	},
	413: {
		_default: 'The file is too large to upload'
	},
	429: {
		rate_limited: 'Too many requests — please wait a moment',
		account_locked: 'Account temporarily locked — too many failed login attempts',
		_default: 'Too many requests — please slow down'
	},
	500: {
		_default: 'Something went wrong on our end — please try again'
	},
	503: {
		_default: 'The service is temporarily unavailable — please try again later'
	}
};

/** Map an ApiError to a user-friendly message. */
export function friendlyError(err: unknown): string {
	if (err instanceof ApiError) {
		const statusMap = ERROR_MESSAGES[err.status];
		if (statusMap) {
			return statusMap[err.code] ?? statusMap._default ?? err.message;
		}
		return err.message;
	}
	if (err instanceof Error) {
		if (err.message === 'Failed to fetch') {
			return 'Unable to reach the server — check your connection';
		}
		return err.message;
	}
	return 'An unexpected error occurred';
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

/** Injects Authorization: Bearer header. Used by newsroom endpoints.
 *  Automatically retries once with a refreshed token on 401. */
export async function authRequest<T>(
	path: string,
	token: string,
	options?: RequestInit
): Promise<T> {
	try {
		return await request<T>(path, {
			...options,
			headers: {
				...options?.headers,
				Authorization: `Bearer ${token}`
			}
		});
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) {
			// Dynamically import to avoid circular dependency
			const { refreshAccessToken } = await import('$lib/newsroom/auth');
			const newToken = await refreshAccessToken();
			if (newToken) {
				return request<T>(path, {
					...options,
					headers: {
						...options?.headers,
						Authorization: `Bearer ${newToken}`
					}
				});
			}
		}
		throw err;
	}
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
