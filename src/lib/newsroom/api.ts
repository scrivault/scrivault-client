/**
 * Newsroom API client.
 * Public endpoints (login/register) use direct fetch.
 * Protected endpoints use authRequest with JWT from auth store.
 */

import { authRequest, ApiError } from '$lib/api';
import { getToken } from './auth';
import type {
	LoginRequest,
	LoginResponse,
	RegisterRequest,
	RegisterResponse,
	TipListResponse,
	TipUpdateRequest,
	TipUpdateResponse,
	NewsroomMessagesResponse,
	NewsroomSendMessageRequest,
	NewsroomSendMessageResponse,
	CreateInvestigationRequest,
	InvestigationSummary,
	InvestigationListResponse,
	InvestigationDetailResponse
} from './types';

const BASE = '/api';

// ── Public request helper (no JWT) ───────────────────────

async function publicRequest<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers
		}
	});

	const body = await res.json();

	if (!res.ok) {
		throw new ApiError(res.status, body.code ?? 'unknown', body.error ?? 'Request failed');
	}

	return body as T;
}

// ── Token helper ─────────────────────────────────────────

function requireToken(): string {
	const token = getToken();
	if (!token) throw new Error('Not authenticated');
	return token;
}

// ── Newsroom API ─────────────────────────────────────────

export const newsroomApi = {
	// Auth (public)

	login(req: LoginRequest): Promise<LoginResponse> {
		return publicRequest<LoginResponse>('/newsroom/login', {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	register(req: RegisterRequest): Promise<RegisterResponse> {
		return publicRequest<RegisterResponse>('/newsroom/register', {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	// Tips (protected)

	getTips(): Promise<TipListResponse> {
		return authRequest<TipListResponse>('/newsroom/tips', requireToken());
	},

	updateTip(threadId: string, req: TipUpdateRequest): Promise<TipUpdateResponse> {
		return authRequest<TipUpdateResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}`,
			requireToken(),
			{ method: 'PATCH', body: JSON.stringify(req) }
		);
	},

	getMessages(threadId: string): Promise<NewsroomMessagesResponse> {
		return authRequest<NewsroomMessagesResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/messages`,
			requireToken()
		);
	},

	sendMessage(
		threadId: string,
		req: NewsroomSendMessageRequest
	): Promise<NewsroomSendMessageResponse> {
		return authRequest<NewsroomSendMessageResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/messages`,
			requireToken(),
			{ method: 'POST', body: JSON.stringify(req) }
		);
	},

	// Investigations (protected)

	createInvestigation(req: CreateInvestigationRequest): Promise<InvestigationSummary> {
		return authRequest<InvestigationSummary>('/newsroom/investigations', requireToken(), {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	getInvestigations(): Promise<InvestigationListResponse> {
		return authRequest<InvestigationListResponse>(
			'/newsroom/investigations',
			requireToken()
		);
	},

	getInvestigation(id: string): Promise<InvestigationDetailResponse> {
		return authRequest<InvestigationDetailResponse>(
			`/newsroom/investigations/${encodeURIComponent(id)}`,
			requireToken()
		);
	}
};
