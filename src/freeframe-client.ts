import type {
  ReviewAsset,
  ReviewBootstrap,
  ReviewComment,
  ReviewCommentAnnotation,
  ReviewCommentAuthor,
  ReviewCommentGuestAuthor,
  ReviewPermissions,
  ReviewScope,
  ReviewStream,
  ReviewVersion,
} from "./domain";

export class FreeFrameError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
export interface FreeFrameReviewContext { workspace_id: string; project_id: string; issue_id: string }
export interface FreeFrameSessionUser { id: string; plane_user_id: string; email: string; name: string }
export interface FreeFrameSession {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: FreeFrameSessionUser;
  context: FreeFrameReviewContext;
  scopes: ReviewScope[];
}
export interface ExpectedReviewContext { projectId: string; issueId: string }
export interface ExpectedReviewBootstrap extends ExpectedReviewContext { assetId: string }

const REVIEW_SCOPES = new Set<ReviewScope>(["review:read", "review:comment", "review:upload", "review:manage"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function uuid(value: unknown): value is string { return nonEmptyString(value) && UUID.test(value); }
function nullableUuid(value: unknown): string | null | undefined { return value === null ? null : uuid(value) ? value : undefined; }
function optionalString(value: unknown): string | null | undefined { return value === null ? null : typeof value === "string" ? value : undefined; }
function nullableFiniteNonNegative(value: unknown): number | null | undefined { return value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function optionalPositiveInteger(value: unknown): number | null | undefined { return value === undefined || value === null ? null : Number.isInteger(value) && (value as number) > 0 ? value as number : undefined; }
function isoDate(value: unknown): value is string { return nonEmptyString(value) && Number.isFinite(Date.parse(value)); }

export function normalizeFreeFrameApiUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new FreeFrameError("FreeFrame API URL is invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new FreeFrameError("FreeFrame API URL is invalid"); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new FreeFrameError("FreeFrame API URL must be a trusted HTTPS endpoint");
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function parseSession(value: unknown, expected?: ExpectedReviewContext): FreeFrameSession {
  const body = record(value), user = record(body?.user), context = record(body?.context);
  if (!body || !nonEmptyString(body.access_token) || body.token_type !== "bearer" || !Number.isInteger(body.expires_in) || (body.expires_in as number) <= 0) throw new FreeFrameError("FreeFrame returned an invalid session", 502);
  if (!user || !uuid(user.id) || !uuid(user.plane_user_id) || !nonEmptyString(user.email) || !nonEmptyString(user.name)) throw new FreeFrameError("FreeFrame returned an invalid session user", 502);
  if (!context || !uuid(context.workspace_id) || !uuid(context.project_id) || !uuid(context.issue_id)) throw new FreeFrameError("FreeFrame returned an invalid review context", 502);
  if (expected && (context.project_id !== expected.projectId || context.issue_id !== expected.issueId)) throw new FreeFrameError("FreeFrame returned a mismatched review context", 403);
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) throw new FreeFrameError("FreeFrame returned invalid scopes", 502);
  const scopes: ReviewScope[] = [], seen = new Set<string>();
  for (const scope of body.scopes) {
    if (typeof scope !== "string" || !REVIEW_SCOPES.has(scope as ReviewScope) || seen.has(scope)) throw new FreeFrameError("FreeFrame returned invalid scopes", 502);
    seen.add(scope); scopes.push(scope as ReviewScope);
  }
  return { access_token: body.access_token, token_type: "bearer", expires_in: body.expires_in as number, user: { id: user.id, plane_user_id: user.plane_user_id, email: user.email, name: user.name }, context: { workspace_id: context.workspace_id, project_id: context.project_id, issue_id: context.issue_id }, scopes };
}

function parseAsset(value: unknown): ReviewAsset {
  const body = record(value);
  if (!body || !uuid(body.id) || !nonEmptyString(body.name) || !nonEmptyString(body.asset_type)) throw new FreeFrameError("FreeFrame returned an invalid review asset", 502);
  const description = optionalString(body.description), status = optionalString(body.status), thumbnailUrl = optionalString(body.thumbnail_url);
  if (description === undefined || status === undefined || thumbnailUrl === undefined) throw new FreeFrameError("FreeFrame returned an invalid review asset", 502);
  return { id: body.id, name: body.name, asset_type: body.asset_type, description, status: status ?? undefined, thumbnail_url: thumbnailUrl };
}

function parseVersion(value: unknown): ReviewVersion {
  const body = record(value);
  if (!body || !uuid(body.id) || !Number.isInteger(body.version_number) || (body.version_number as number) <= 0 || !nonEmptyString(body.processing_status) || !["uploading", "processing", "ready", "failed"].includes(body.processing_status)) throw new FreeFrameError("FreeFrame returned an invalid review version", 502);
  const createdAt = optionalString(body.created_at), originalFilename = optionalString(body.original_filename), mimeType = optionalString(body.mime_type), fileSizeBytes = nullableFiniteNonNegative(body.file_size_bytes);
  const durationSeconds = body.duration_seconds === undefined ? null : nullableFiniteNonNegative(body.duration_seconds);
  const fpsNumerator = optionalPositiveInteger(body.fps_numerator), fpsDenominator = optionalPositiveInteger(body.fps_denominator);
  if (createdAt === undefined || originalFilename === undefined || mimeType === undefined || fileSizeBytes === undefined || durationSeconds === undefined || fpsNumerator === undefined || fpsDenominator === undefined || ((fpsNumerator === null) !== (fpsDenominator === null))) throw new FreeFrameError("FreeFrame returned an invalid review version", 502);
  return { id: body.id, version_number: body.version_number as number, processing_status: body.processing_status, created_at: createdAt, original_filename: originalFilename, mime_type: mimeType, file_size_bytes: fileSizeBytes, duration_seconds: durationSeconds, fps_numerator: fpsNumerator, fps_denominator: fpsDenominator };
}

function parsePermissions(value: unknown): ReviewPermissions {
  const body = record(value);
  if (!body || typeof body.read !== "boolean" || typeof body.comment !== "boolean" || typeof body.upload !== "boolean" || typeof body.manage !== "boolean") throw new FreeFrameError("FreeFrame returned invalid review permissions", 502);
  return { read: body.read, comment: body.comment, upload: body.upload, manage: body.manage };
}

function parseBootstrap(value: unknown, expected: ExpectedReviewBootstrap): ReviewBootstrap {
  const body = record(value), context = record(body?.context);
  if (!body || !context || !uuid(context.workspace_id) || !uuid(context.project_id) || !uuid(context.issue_id)) throw new FreeFrameError("FreeFrame returned an invalid review bootstrap context", 502);
  if (context.project_id !== expected.projectId || context.issue_id !== expected.issueId) throw new FreeFrameError("FreeFrame returned a mismatched review bootstrap context", 403);
  const asset = parseAsset(body.asset);
  if (asset.id !== expected.assetId) throw new FreeFrameError("FreeFrame returned a mismatched review asset", 403);
  if (!Array.isArray(body.versions)) throw new FreeFrameError("FreeFrame returned invalid review versions", 502);
  return { context: { workspace_id: context.workspace_id, project_id: context.project_id, issue_id: context.issue_id }, asset, versions: body.versions.map(parseVersion), permissions: parsePermissions(body.permissions) };
}

function parseAuthor(value: unknown): ReviewCommentAuthor | null {
  if (value === null) return null;
  const body = record(value);
  const avatar = optionalString(body?.avatar_url);
  if (!body || !uuid(body.id) || !nonEmptyString(body.name) || avatar === undefined) throw new FreeFrameError("FreeFrame returned an invalid comment author", 502);
  return { id: body.id, name: body.name, avatar_url: avatar };
}
function parseGuestAuthor(value: unknown): ReviewCommentGuestAuthor | null {
  if (value === null) return null;
  const body = record(value);
  if (!body || !uuid(body.id) || !nonEmptyString(body.name) || !nonEmptyString(body.email)) throw new FreeFrameError("FreeFrame returned an invalid guest comment author", 502);
  return { id: body.id, name: body.name, email: body.email };
}
function parseAnnotation(value: unknown, commentId: string): ReviewCommentAnnotation | null {
  if (value === null) return null;
  const body = record(value);
  const frameNumber = body?.frame_number === null ? null : Number.isInteger(body?.frame_number) && (body!.frame_number as number) >= 0 ? body!.frame_number as number : undefined;
  const carouselPosition = body?.carousel_position === null ? null : Number.isInteger(body?.carousel_position) && (body!.carousel_position as number) >= 0 ? body!.carousel_position as number : undefined;
  const drawing = record(body?.drawing_data);
  if (!body || !uuid(body.id) || body.comment_id !== commentId || !drawing || frameNumber === undefined || carouselPosition === undefined) throw new FreeFrameError("FreeFrame returned an invalid comment annotation", 502);
  return { id: body.id, comment_id: commentId, drawing_data: drawing, frame_number: frameNumber, carousel_position: carouselPosition };
}
export function parseComment(value: unknown, expectedAssetId: string, expectedVersionId: string): ReviewComment {
  const body = record(value);
  if (!body || !uuid(body.id) || body.asset_id !== expectedAssetId || body.version_id !== expectedVersionId) throw new FreeFrameError("FreeFrame returned a mismatched review comment", 403);
  const parentId = nullableUuid(body.parent_id), authorId = nullableUuid(body.author_id), guestAuthorId = nullableUuid(body.guest_author_id), start = nullableFiniteNonNegative(body.timecode_start), end = nullableFiniteNonNegative(body.timecode_end);
  if (parentId === undefined || authorId === undefined || guestAuthorId === undefined || start === undefined || end === undefined || (start !== null && end !== null && end < start) || !nonEmptyString(body.body) || typeof body.resolved !== "boolean" || body.visibility !== "public" || !isoDate(body.created_at) || !isoDate(body.updated_at) || !Array.isArray(body.replies) || !Array.isArray(body.attachments) || !Array.isArray(body.reactions)) throw new FreeFrameError("FreeFrame returned an invalid review comment", 502);
  const author = parseAuthor(body.author ?? null);
  const guestAuthor = parseGuestAuthor(body.guest_author ?? null);
  const annotation = parseAnnotation(body.annotation ?? null, body.id);
  const replies = body.replies.map(reply => parseComment(reply, expectedAssetId, expectedVersionId));
  return { id: body.id, asset_id: expectedAssetId, version_id: expectedVersionId, parent_id: parentId, author_id: authorId, guest_author_id: guestAuthorId, timecode_start: start, timecode_end: end, body: body.body, resolved: body.resolved, visibility: "public", created_at: body.created_at, updated_at: body.updated_at, author, guest_author: guestAuthor, annotation, replies };
}

export interface ReviewCommentCreateInput { body: string; timecode_start?: number; timecode_end?: number; annotation?: { drawing_data: Record<string, unknown>; frame_number?: number } }

export class FreeFrameClient {
  private accessToken = "";
  readonly root: string;
  readonly origin: string;
  constructor(root: string) { this.root = normalizeFreeFrameApiUrl(root); this.origin = new URL(this.root).origin; }
  private async parse<T>(response: Response): Promise<T> { const text = await response.text(); let body: unknown; if (text) { try { body = JSON.parse(text); } catch { throw new FreeFrameError("FreeFrame returned invalid JSON", 502); } } if (!response.ok) throw new FreeFrameError("FreeFrame request failed", response.status); return body as T; }
  private request<T>(path: string, init: RequestInit = {}): Promise<T> { if (!this.accessToken) throw new FreeFrameError("FreeFrame session is missing", 401); return fetch(`${this.root}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } }).then(response => this.parse<T>(response)); }
  async exchange(integrationToken: string, expected?: ExpectedReviewContext): Promise<FreeFrameSession> { if (!integrationToken) throw new FreeFrameError("Plane integration token is missing", 401); const response = await fetch(`${this.root}/integrations/plane/session`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ token: integrationToken }) }); const session = parseSession(await this.parse<unknown>(response), expected); this.accessToken = session.access_token; return session; }
  clearSession(): void { this.accessToken = ""; }
  async bootstrap(assetId: string, expected: ExpectedReviewContext, signal?: AbortSignal): Promise<ReviewBootstrap> { if (!uuid(assetId)) throw new FreeFrameError("FreeFrame asset ID is invalid", 400); return parseBootstrap(await this.request<unknown>(`/integrations/plane/assets/${encodeURIComponent(assetId)}/review`, { signal }), { ...expected, assetId }); }
  async stream(assetId: string, versionId: string, signal?: AbortSignal): Promise<ReviewStream> {
    if (!uuid(assetId) || !uuid(versionId)) throw new FreeFrameError("FreeFrame stream context is invalid", 400);
    const payload = record(await this.request<unknown>(`/integrations/plane/assets/${encodeURIComponent(assetId)}/stream?version_id=${encodeURIComponent(versionId)}`, { signal }));
    if (!payload || !nonEmptyString(payload.url) || payload.asset_type !== "video") throw new FreeFrameError("FreeFrame returned invalid playback metadata", 502);
    const expiresIn = payload.expires_in === undefined ? 3600 : payload.expires_in;
    if (!Number.isInteger(expiresIn) || (expiresIn as number) <= 0) throw new FreeFrameError("FreeFrame returned invalid playback metadata", 502);
    if (payload.url.startsWith("/")) {
      if (payload.url.startsWith("//")) throw new FreeFrameError("FreeFrame returned an unsafe playback URL", 502);
    } else {
      let parsed: URL;
      try { parsed = new URL(payload.url); } catch { throw new FreeFrameError("FreeFrame returned an unsafe playback URL", 502); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new FreeFrameError("FreeFrame returned an unsafe playback URL", 502);
    }
    return { url: payload.url, asset_type: "video", expires_in: expiresIn as number };
  }
  async comments(assetId: string, versionId: string, signal?: AbortSignal): Promise<ReviewComment[]> { if (!uuid(assetId) || !uuid(versionId)) throw new FreeFrameError("FreeFrame comment context is invalid", 400); const payload = await this.request<unknown>(`/integrations/plane/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/comments`, { signal }); if (!Array.isArray(payload)) throw new FreeFrameError("FreeFrame returned invalid review comments", 502); return payload.map(comment => parseComment(comment, assetId, versionId)); }
  async createComment(assetId: string, versionId: string, input: ReviewCommentCreateInput, signal?: AbortSignal): Promise<ReviewComment> { if (!uuid(assetId) || !uuid(versionId)) throw new FreeFrameError("FreeFrame comment context is invalid", 400); const body = input.body.trim(); if (!body || body.length > 5000) throw new FreeFrameError("Review comment body is invalid", 400); for (const value of [input.timecode_start, input.timecode_end]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new FreeFrameError("Review comment timing is invalid", 400); if (input.timecode_start !== undefined && input.timecode_end !== undefined && input.timecode_end < input.timecode_start) throw new FreeFrameError("Review comment range is invalid", 400); if (input.annotation?.frame_number !== undefined && (!Number.isInteger(input.annotation.frame_number) || input.annotation.frame_number < 0)) throw new FreeFrameError("Review comment frame is invalid", 400); const payload = await this.request<unknown>(`/integrations/plane/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/comments`, { method: "POST", body: JSON.stringify({ ...input, body }), signal }); return parseComment(payload, assetId, versionId); }
  async toggleResolved(assetId: string, versionId: string, commentId: string, signal?: AbortSignal): Promise<ReviewComment> { if (!uuid(assetId) || !uuid(versionId) || !uuid(commentId)) throw new FreeFrameError("FreeFrame resolve context is invalid", 400); return parseComment(await this.request<unknown>(`/integrations/plane/assets/${encodeURIComponent(assetId)}/comments/${encodeURIComponent(commentId)}/resolve`, { method: "POST", signal }), assetId, versionId); }
  requestJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> { return this.request(path, { method: "POST", body: JSON.stringify(body), signal }); }
}
