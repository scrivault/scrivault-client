/**
 * TypeScript interfaces for the newsroom API.
 * Maps directly to Go types in scrivault-server/internal/api/newsroom_*.go
 */

// ── Auth ──────────────────────────────────────────────────

export interface LoginRequest {
	email: string;
	password: string;
}

export interface LoginResponse {
	token: string;
	refresh_token?: string;
	journalist_id: string;
	email: string;
	display_name: string;
	role: 'editor' | 'reporter';
	expires_at: string;
	refresh_expires_at?: string;
	encrypted_private_key?: string; // base64
	private_key_nonce?: string; // base64
	key_salt?: string; // base64
}

export interface RegisterRequest {
	email: string;
	password: string;
	display_name: string;
	invite_token: string;
	role?: 'editor' | 'reporter';
	public_key?: string; // base64
	encrypted_private_key?: string; // base64
	private_key_nonce?: string; // base64
	key_salt?: string; // base64
}

export interface RegisterResponse {
	journalist_id: string;
	email: string;
	display_name: string;
	role: string;
	created_at: string;
}

// ── Tips ──────────────────────────────────────────────────

export type TipStatus = 'new' | 'review' | 'active' | 'closed';

export interface TipSummary {
	id: string;
	blinded_id: string;
	status: TipStatus;
	assigned_to: string | null;
	assignee_name: string | null;
	message_count: number;
	document_count: number;
	unread_count: number;
	last_activity: string;
	created_at: string;
	first_message_ciphertext?: string; // base64
	first_message_nonce?: string; // base64
	sealed_key?: string; // base64
}

export interface TipListResponse {
	tips: TipSummary[];
}

export interface TipUpdateRequest {
	status?: TipStatus;
	assigned_to?: string;
}

export interface TipUpdateResponse {
	thread_id: string;
	status: TipStatus;
	updated_at: string;
}

// ── Messages (newsroom view — encrypted, no decryption) ──

export interface NewsroomMessage {
	id: string;
	ciphertext: string; // base64
	nonce: string; // base64
	sender_role: 'source' | 'journalist';
	sender_display_name?: string;
	ordinal: number;
	created_at: string;
}

export interface NewsroomMessagesResponse {
	messages: NewsroomMessage[];
}

export interface NewsroomSendMessageRequest {
	ciphertext: string; // base64
	nonce: string; // base64
}

export interface NewsroomSendMessageResponse {
	message_id: string;
	ordinal: number;
	created_at: string;
}

// ── Documents ────────────────────────────────────────────

export interface DocumentMeta {
	id: string;
	thread_id: string;
	sha256_hash: string;
	file_size: number;
	encrypted_name?: string; // base64
	name_nonce?: string; // base64
	created_at: string;
}

export interface DocumentListResponse {
	documents: DocumentMeta[];
}

// ── Investigations ────────────────────────────────────────

export interface CreateInvestigationRequest {
	thread_id: string;
	codename: string;
}

export interface InvestigationSummary {
	id: string;
	thread_id: string;
	codename: string;
	created_by: string;
	created_at: string;
	updated_at: string;
}

export interface InvestigationListResponse {
	investigations: InvestigationSummary[];
}

export interface InvestigationMember {
	journalist_id: string;
	display_name: string;
	role: string;
	joined_at: string;
}

export interface InvestigationDetailResponse {
	id: string;
	thread_id: string;
	codename: string;
	created_by: string;
	created_at: string;
	updated_at: string;
	members: InvestigationMember[];
}

// ── Key Exchange ─────────────────────────────────────────

export interface PublicKeyPayload {
	journalist_id: string;
	public_key: string; // base64
}

export interface PublicKeysResponse {
	keys: PublicKeyPayload[];
}

export interface SealedKeyResponse {
	sealed_key: string; // base64
}

export interface CreateKeyGrantRequest {
	journalist_id: string;
	sealed_key: string; // base64
}

// ── Setup ────────────────────────────────────────────────

export interface SetupRequest {
	org_name: string;
	org_slug: string;
	admin_email: string;
	admin_display_name: string;
	admin_password: string;
	public_key?: string; // base64
	encrypted_private_key?: string; // base64
	private_key_nonce?: string; // base64
	key_salt?: string; // base64
}

export interface SetupResponse {
	token: string;
	journalist_id: string;
	role: string;
	expires_at: string;
	organization: OrganizationInfo;
}

export interface SetupStatusResponse {
	needs_setup: boolean;
	organization?: OrganizationInfo;
}

export interface OrganizationInfo {
	name: string;
	slug: string;
}

// ── Invites ──────────────────────────────────────────────

export interface CreateInviteRequest {
	email: string;
	role: 'editor' | 'reporter';
}

export interface InviteResponse {
	id: string;
	email: string;
	role: string;
	token?: string; // Only returned on create, not on list
	created_at: string;
	expires_at: string;
}

export interface InviteListResponse {
	invites: InviteResponse[];
}

// ── Team ─────────────────────────────────────────────────

export interface TeamMember {
	id: string;
	email: string;
	display_name: string;
	role: 'editor' | 'reporter';
	created_at: string;
}

export interface TeamListResponse {
	members: TeamMember[];
}

// ── Thread workflow ──────────────────────────────────────

export interface UpdateStatusRequest {
	status: TipStatus;
}

export interface AssignThreadRequest {
	journalist_id: string;
}

export interface ThreadDetailResponse {
	id: string;
	status: TipStatus;
	assigned_to?: string;
	assigned_at?: string;
	updated_at: string;
}

// ── Thread notes ─────────────────────────────────────────

export interface ThreadNote {
	id: string;
	thread_id: string;
	journalist_id: string;
	author_name?: string;
	ciphertext: string; // base64
	nonce: string; // base64
	created_at: string;
}

export interface ThreadNoteListResponse {
	notes: ThreadNote[];
}

export interface CreateThreadNoteRequest {
	ciphertext: string; // base64
	nonce: string; // base64
}

// ── Account management ──────────────────────────────────

export interface ChangePasswordRequest {
	current_password: string;
	new_password: string;
	encrypted_private_key: string; // base64
	private_key_nonce: string; // base64
	key_salt: string; // base64
}

export interface ChangePasswordResponse {
	message: string;
}

// ── Tip filter params ────────────────────────────────────

export interface TipFilterParams {
	status?: TipStatus;
	assigned_to?: string;
}
