import type { ReviewBootstrap, ReviewComment, ReviewScope } from "./domain";

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

const REVIEW_SCOPES = new Set<ReviewScope>(["review:read", "review:comment", "review:upload", "review:manage"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function uuid(value: unknown): value is string { return nonEmptyString(value) && UUID.test(value); }

export function normalizeFreeFrameApiUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new FreeFrameError("FreeFrame API URL is invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new FreeFrameError("FreeFrame API URL is invalid"); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new FreeFrameError("FreeFrame API URL must be a trusted HTTPS endpoint");
  }
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function parseSession(value: unknown, expected?: ExpectedReviewContext): FreeFrameSession {
  const body = record(value);
  const user = record(body?.user);
  const context = record(body?.context);
  if (!body || !nonEmptyString(body.access_token) || body.token_type !== "bearer" || !Number.isInteger(body.expires_in) || (body.expires_in as number) <= 0) {
    throw new FreeFrameError("FreeFrame returned an invalid session", 502);
  }
  if (!user || !uuid(user.id) || !uuid(user.plane_user_id) || !nonEmptyString(user.email) || !nonEmptyString(user.name)) {
    throw new FreeFrameError("FreeFrame returned an invalid session user", 502);
  }
  if (!context || !uuid(context.workspace_id) || !uuid(context.project_id) || !uuid(context.issue_id)) {
    throw new FreeFrameError("FreeFrame returned an invalid review context", 502);
  }
  if (expected && (context.project_id !== expected.projectId || context.issue_id !== expected.issueId)) {
    throw new FreeFrameError("FreeFrame returned a mismatched review context", 403);
  }
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) throw new FreeFrameError("FreeFrame returned invalid scopes", 502);
  const scopes: ReviewScope[] = [];
  const seen = new Set<string>();
  for (const scope of body.scopes) {
    if (typeof scope !== "string" || !REVIEW_SCOPES.has(scope as ReviewScope) || seen.has(scope)) throw new FreeFrameError("FreeFrame returned invalid scopes", 502);
    seen.add(scope);
    scopes.push(scope as ReviewScope);
  }
  return {
    access_token: body.access_token,
    token_type: "bearer",
    expires_in: body.expires_in as number,
    user: { id: user.id, plane_user_id: user.plane_user_id, email: user.email, name: user.name },
    context: { workspace_id: context.workspace_id, project_id: context.project_id, issue_id: context.issue_id },
    scopes,
  };
}

export class FreeFrameClient {
  private accessToken = "";
  readonly root: string;
  readonly origin: string;
  constructor(root: string) {
    this.root = normalizeFreeFrameApiUrl(root);
    this.origin = new URL(this.root).origin;
  }

  private async parse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let body: unknown;
    if (text) { try { body = JSON.parse(text); } catch { throw new FreeFrameError("FreeFrame returned invalid JSON", 502); } }
    if (!response.ok) throw new FreeFrameError("FreeFrame request failed", response.status);
    return body as T;
  }
  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.accessToken) throw new FreeFrameError("FreeFrame session is missing", 401);
    return fetch(`${this.root}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } }).then(r => this.parse<T>(r));
  }

  async exchange(integrationToken: string, expected?: ExpectedReviewContext): Promise<FreeFrameSession> {
    if (!integrationToken) throw new FreeFrameError("Plane integration token is missing", 401);
    const response = await fetch(`${this.root}/integrations/plane/session`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ token: integrationToken }) });
    const session = parseSession(await this.parse<unknown>(response), expected);
    this.accessToken = session.access_token;
    return session;
  }
  clearSession(): void { this.accessToken = ""; }
  bootstrap(assetId: string): Promise<ReviewBootstrap> { return this.request(`/integrations/plane/assets/${encodeURIComponent(assetId)}/review`); }
  comments(assetId: string, versionId: string): Promise<ReviewComment[]> { return this.request(`/integrations/plane/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/comments`); }
  createComment(assetId: string, versionId: string, body: { body: string; timecode_start?: number; timecode_end?: number; annotation?: { drawing_data: Record<string, unknown>; frame_number?: number } }): Promise<ReviewComment> {
    return this.request(`/integrations/plane/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/comments`, { method: "POST", body: JSON.stringify(body) });
  }
  toggleResolved(assetId: string, commentId: string): Promise<ReviewComment> { return this.request(`/integrations/plane/assets/${encodeURIComponent(assetId)}/comments/${encodeURIComponent(commentId)}/resolve`, { method: "POST" }); }
  requestJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> { return this.request(path, { method: "POST", body: JSON.stringify(body), signal }); }
}
