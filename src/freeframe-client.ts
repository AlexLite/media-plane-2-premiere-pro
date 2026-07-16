import type { ReviewBootstrap, ReviewComment, ReviewScope } from "./domain";

export class FreeFrameError extends Error { constructor(message: string, readonly status?: number) { super(message); } }

export interface FreeFrameSession { access_token: string; expires_in: number; scopes: ReviewScope[] }

export class FreeFrameClient {
  private accessToken = "";
  constructor(readonly root: string) {
    const parsed = new URL(root);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new FreeFrameError("FreeFrame API URL must use HTTPS");
    this.root = parsed.origin + parsed.pathname.replace(/\/$/, "");
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
    return fetch(`${this.root}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } }).then(r => this.parse<T>(r));
  }

  async exchange(integrationToken: string): Promise<FreeFrameSession> {
    const response = await fetch(`${this.root}/integrations/plane/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: integrationToken }) });
    const session = await this.parse<FreeFrameSession>(response);
    if (!session.access_token || !Number.isFinite(session.expires_in) || !Array.isArray(session.scopes)) throw new FreeFrameError("FreeFrame returned an invalid session", 502);
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
