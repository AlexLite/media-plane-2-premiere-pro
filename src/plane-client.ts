import type { PlaneUser, ProjectSummary, ReviewAsset, ReviewSessionState, WorkspaceSummary, WorkItem } from "./domain";
import { normalizeFreeFrameApiUrl } from "./freeframe-client";

export class PlaneError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) { super(message); }
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)) return (value as { results: unknown[] }).results;
  throw new PlaneError("Plane returned an invalid list", 502);
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function optionalString(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function nullableString(value: unknown): string | null | undefined { return value === null ? null : typeof value === "string" ? value : undefined; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUser(value: unknown): PlaneUser {
  const body = record(value);
  if (!body || !nonEmptyString(body.id) || !nonEmptyString(body.email)) throw new PlaneError("Plane returned an invalid user", 502, value);
  const firstName = optionalString(body.first_name) ?? "";
  const lastName = optionalString(body.last_name) ?? "";
  const displayName = optionalString(body.display_name) ?? (`${firstName} ${lastName}`.trim() || body.email);
  return { id: body.id, email: body.email, displayName };
}
function parseWorkspace(value: unknown): WorkspaceSummary {
  const body = record(value);
  if (!body || !nonEmptyString(body.id) || !nonEmptyString(body.slug) || !nonEmptyString(body.name)) throw new PlaneError("Plane returned an invalid workspace", 502, value);
  return { id: body.id, slug: body.slug, name: body.name };
}
function parseProject(value: unknown): ProjectSummary {
  const body = record(value);
  if (!body || !nonEmptyString(body.id) || !nonEmptyString(body.name)) throw new PlaneError("Plane returned an invalid project", 502, value);
  return { id: body.id, name: body.name, identifier: optionalString(body.identifier) };
}
function parseWorkItem(value: unknown): WorkItem {
  const body = record(value);
  if (!body || !nonEmptyString(body.id) || !nonEmptyString(body.name) || !nonEmptyString(body.identifier)) throw new PlaneError("Plane returned an invalid work item", 502, value);
  return { id: body.id, name: body.name, identifier: body.identifier };
}

function parseReviewAsset(value: unknown): ReviewAsset {
  const body = record(value);
  const description = nullableString(body?.description);
  const thumbnailUrl = nullableString(body?.thumbnail_url);
  if (!body || !nonEmptyString(body.id) || !UUID.test(body.id) || !nonEmptyString(body.name) || !nonEmptyString(body.asset_type) || description === undefined || thumbnailUrl === undefined) {
    throw new PlaneError("Plane returned an invalid review asset", 502, value);
  }
  return {
    id: body.id,
    name: body.name,
    asset_type: body.asset_type,
    description,
    status: optionalString(body.status),
    thumbnail_url: thumbnailUrl,
  };
}

export class PlaneClient {
  readonly root: string;
  constructor(baseUrl: string, private readonly token: string) {
    if (!token) throw new PlaneError("Plane token is missing", 401);
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new PlaneError("Plane URL is invalid"); }
    const localHttp = parsed.protocol === "http:" && parsed.hostname === "localhost";
    if ((parsed.protocol !== "https:" && !localHttp) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new PlaneError("Plane URL must use HTTPS");
    this.root = parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
  }

  private async request<T>(path: string, init: RequestInit = {}, allow404 = false): Promise<T | undefined> {
    const response = await fetch(`${this.root}${path}`, {
      ...init,
      headers: { "X-API-Key": this.token, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
    let body: unknown;
    const text = await response.text();
    if (text) { try { body = JSON.parse(text); } catch { throw new PlaneError("Plane returned invalid JSON", 502); } }
    if (allow404 && response.status === 404) return body as T;
    if (!response.ok) throw new PlaneError("Plane request failed", response.status, body);
    return body as T;
  }

  async getCurrentUser(): Promise<PlaneUser> { return parseUser(await this.request("/api/users/me/")); }
  async getWorkspaces(): Promise<WorkspaceSummary[]> { return list(await this.request("/api/v1/workspaces/")).map(parseWorkspace); }
  async validate(): Promise<{ user: PlaneUser; workspaces: WorkspaceSummary[] }> {
    const [user, workspaces] = await Promise.all([this.getCurrentUser(), this.getWorkspaces()]);
    return { user, workspaces };
  }
  async getProjects(workspace: string): Promise<ProjectSummary[]> { return list(await this.request(`/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/`)).map(parseProject); }
  async getIssues(workspace: string, project: string): Promise<WorkItem[]> { return list(await this.request(`/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/`)).map(parseWorkItem); }
  async getWorkItem(workspace: string, project: string, issue: string): Promise<WorkItem> {
    return parseWorkItem(await this.request(`/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/`));
  }

  private reviewPath(workspace: string, project: string, issue: string, suffix: "session" | "assets"): string {
    return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/freeframe-review-${suffix}/`;
  }

  async getReviewSession(workspace: string, project: string, issue: string): Promise<ReviewSessionState> {
    const body = record(await this.request<unknown>(this.reviewPath(workspace, project, issue, "session"), {}, true));
    if (body && "error" in body) {
      if (typeof body.can_manage !== "boolean") throw new PlaneError("Plane returned an invalid unlinked state", 502, body);
      return { linked: false, can_manage: body.can_manage };
    }
    if (!body || !nonEmptyString(body.asset_id) || !UUID.test(body.asset_id) || !nonEmptyString(body.integration_token) || !Number.isInteger(body.expires_in) || (body.expires_in as number) <= 0 || typeof body.can_manage !== "boolean") {
      throw new PlaneError("Plane returned an invalid review session", 502, body);
    }
    let freeframeApiUrl: string;
    try { freeframeApiUrl = normalizeFreeFrameApiUrl(body.freeframe_api_url); }
    catch { throw new PlaneError("Plane returned an invalid trusted FreeFrame API URL", 502, body); }
    return {
      linked: true,
      session: {
        asset_id: body.asset_id,
        integration_token: body.integration_token,
        expires_in: body.expires_in as number,
        can_manage: body.can_manage,
        freeframe_api_url: freeframeApiUrl,
      },
    };
  }

  async searchAssets(workspace: string, project: string, issue: string, query = ""): Promise<ReviewAsset[]> {
    const path = `${this.reviewPath(workspace, project, issue, "assets")}?q=${encodeURIComponent(query)}&limit=50`;
    return list(await this.request(path)).map(parseReviewAsset);
  }
  async createAsset(workspace: string, project: string, issue: string, name: string): Promise<ReviewAsset> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 255) throw new PlaneError("Asset name is invalid", 400);
    return parseReviewAsset(await this.request<unknown>(this.reviewPath(workspace, project, issue, "assets"), { method: "POST", body: JSON.stringify({ name: normalizedName, asset_type: "video", description: null }) }));
  }
  async linkAsset(workspace: string, project: string, issue: string, assetId: string): Promise<string> {
    if (!UUID.test(assetId)) throw new PlaneError("Asset ID is invalid", 400);
    const body = record(await this.request<unknown>(this.reviewPath(workspace, project, issue, "session"), { method: "PUT", body: JSON.stringify({ asset_id: assetId }) }));
    if (!body || body.asset_id !== assetId) throw new PlaneError("Plane returned an invalid linked asset", 502, body);
    return assetId;
  }
  async unlinkAsset(workspace: string, project: string, issue: string): Promise<void> {
    await this.request(this.reviewPath(workspace, project, issue, "session"), { method: "DELETE" });
  }
}
