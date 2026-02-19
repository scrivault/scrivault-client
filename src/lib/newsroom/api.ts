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
	TipFilterParams,
	NewsroomMessagesResponse,
	NewsroomSendMessageRequest,
	NewsroomSendMessageResponse,
	CreateInvestigationRequest,
	InvestigationSummary,
	InvestigationListResponse,
	InvestigationDetailResponse,
	PublicKeysResponse,
	SealedKeyResponse,
	CreateKeyGrantRequest,
	SetupRequest,
	SetupResponse,
	SetupStatusResponse,
	OrganizationInfo,
	CreateInviteRequest,
	InviteResponse,
	InviteListResponse,
	TeamListResponse,
	UpdateStatusRequest,
	AssignThreadRequest,
	ThreadDetailResponse,
	ThreadNote,
	ThreadNoteListResponse,
	CreateThreadNoteRequest,
	ChangePasswordRequest,
	ChangePasswordResponse
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

	getTips(filter?: TipFilterParams): Promise<TipListResponse> {
		const params = new URLSearchParams();
		if (filter?.status) params.set('status', filter.status);
		if (filter?.assigned_to) params.set('assigned_to', filter.assigned_to);
		const qs = params.toString();
		return authRequest<TipListResponse>(
			`/newsroom/tips${qs ? `?${qs}` : ''}`,
			requireToken()
		);
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
	},

	// Key exchange

	/** Fetch editor public keys (public endpoint, no auth). */
	getEditorPublicKeys(): Promise<PublicKeysResponse> {
		return publicRequest<PublicKeysResponse>('/newsroom/pubkeys?role=editor');
	},

	/** Fetch reporter public keys (public endpoint, no auth). */
	getReporterPublicKeys(): Promise<PublicKeysResponse> {
		return publicRequest<PublicKeysResponse>('/newsroom/pubkeys?role=reporter');
	},

	/** Get the sealed thread key for the current journalist. */
	getSealedKey(threadId: string): Promise<SealedKeyResponse> {
		return authRequest<SealedKeyResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/key`,
			requireToken()
		);
	},

	/** Grant a sealed thread key to another journalist (editor-only). */
	grantKey(threadId: string, req: CreateKeyGrantRequest): Promise<SealedKeyResponse> {
		return authRequest<SealedKeyResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/grant`,
			requireToken(),
			{ method: 'POST', body: JSON.stringify(req) }
		);
	},

	// Setup (public)

	/** Check if the instance needs first-run setup. */
	getSetupStatus(): Promise<SetupStatusResponse> {
		return publicRequest<SetupStatusResponse>('/setup/status');
	},

	/** Create organization and first editor account (first-run only). */
	setup(req: SetupRequest): Promise<SetupResponse> {
		return publicRequest<SetupResponse>('/setup', {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	/** Get public org info for branding. */
	getOrganization(): Promise<OrganizationInfo> {
		return publicRequest<OrganizationInfo>('/organization');
	},

	// Invites (protected, editor-only)

	/** Create an invite for a new journalist. */
	createInvite(req: CreateInviteRequest): Promise<InviteResponse> {
		return authRequest<InviteResponse>('/newsroom/invites', requireToken(), {
			method: 'POST',
			body: JSON.stringify(req)
		});
	},

	/** List pending (unused, unexpired) invites. */
	getInvites(): Promise<InviteListResponse> {
		return authRequest<InviteListResponse>('/newsroom/invites', requireToken());
	},

	// Thread workflow (protected)

	/** Update thread status. Any journalist on the thread can change status. */
	updateThreadStatus(threadId: string, status: UpdateStatusRequest['status']): Promise<ThreadDetailResponse> {
		return authRequest<ThreadDetailResponse>(
			`/newsroom/threads/${encodeURIComponent(threadId)}/status`,
			requireToken(),
			{ method: 'PATCH', body: JSON.stringify({ status }) }
		);
	},

	/** Assign a thread to a journalist. Editor-only. */
	assignThread(threadId: string, journalistId: string): Promise<ThreadDetailResponse> {
		return authRequest<ThreadDetailResponse>(
			`/newsroom/threads/${encodeURIComponent(threadId)}/assign`,
			requireToken(),
			{ method: 'PATCH', body: JSON.stringify({ journalist_id: journalistId }) }
		);
	},

	/** Unassign a thread. Editor-only. */
	unassignThread(threadId: string): Promise<ThreadDetailResponse> {
		return authRequest<ThreadDetailResponse>(
			`/newsroom/threads/${encodeURIComponent(threadId)}/unassign`,
			requireToken(),
			{ method: 'PATCH' }
		);
	},

	// Team (protected)

	/** List all team members. */
	getTeamMembers(): Promise<TeamListResponse> {
		return authRequest<TeamListResponse>('/newsroom/team', requireToken());
	},

	// Read receipts (protected)

	/** Mark a thread as read for the current journalist. */
	markRead(threadId: string): Promise<{ status: string }> {
		return authRequest<{ status: string }>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/read`,
			requireToken(),
			{ method: 'POST' }
		);
	},

	// Thread notes (protected)

	/** Create an encrypted thread note. */
	createNote(threadId: string, req: CreateThreadNoteRequest): Promise<ThreadNote> {
		return authRequest<ThreadNote>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/notes`,
			requireToken(),
			{ method: 'POST', body: JSON.stringify(req) }
		);
	},

	/** List notes for a thread. */
	getNotes(threadId: string): Promise<ThreadNoteListResponse> {
		return authRequest<ThreadNoteListResponse>(
			`/newsroom/tips/${encodeURIComponent(threadId)}/notes`,
			requireToken()
		);
	},

	/** Delete a thread note by ID. */
	async deleteNote(threadId: string, noteId: string): Promise<void> {
		const token = requireToken();
		const res = await fetch(`${BASE}/newsroom/tips/${encodeURIComponent(threadId)}/notes/${encodeURIComponent(noteId)}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			let code = 'unknown';
			let message = 'Failed to delete note';
			try {
				const body = await res.json();
				code = body.code ?? code;
				message = body.error ?? message;
			} catch { /* Non-JSON error body */ }
			throw new ApiError(res.status, code, message);
		}
	},

	// Team deactivation (protected, editor-only)

	/** Deactivate a team member. Revokes all key grants. */
	deactivateTeamMember(journalistId: string): Promise<{ status: string }> {
		return authRequest<{ status: string }>(
			`/newsroom/team/${encodeURIComponent(journalistId)}/deactivate`,
			requireToken(),
			{ method: 'PATCH' }
		);
	},

	// Account management (protected)

	/** Change password and re-encrypt private key. */
	changePassword(req: ChangePasswordRequest): Promise<ChangePasswordResponse> {
		return authRequest<ChangePasswordResponse>('/newsroom/account/password', requireToken(), {
			method: 'PATCH',
			body: JSON.stringify(req)
		});
	},

	/** Revoke an invite by ID. Returns 204 No Content on success. */
	async revokeInvite(id: string): Promise<void> {
		const token = requireToken();
		const res = await fetch(`${BASE}/newsroom/invites/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			let code = 'unknown';
			let message = 'Failed to revoke invite';
			try {
				const body = await res.json();
				code = body.code ?? code;
				message = body.error ?? message;
			} catch {
				// Non-JSON error body
			}
			throw new ApiError(res.status, code, message);
		}
	}
};
