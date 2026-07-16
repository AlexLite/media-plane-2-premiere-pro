import type { ProjectSummary, ReviewAsset, ReviewSessionState, WorkItem } from "./domain";
import { normalizeFreeFrameApiUrl } from "./freeframe-client";

export class PlaneError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) { super(message); }
}

function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)) return (value as { results: T[] }).results;
  throw new PlaneError("Plane returned an invalid list", 502);
}
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

export class PlaneClient {
  readonly root: string;
  constructor(baseUrl: string, private readonly token: string) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new PlaneError("Plane URL must use HTTPS");
    this.root = parsed.origin + parsed.pathname.replace(/\/$/, "");
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

  async validate(): Promise<void> { await this.request("/api/v1/workspaces/"); }
  async getProjects(workspace: string): Promise<ProjectSummary[]> { return list(await this.request(`/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/`)); }
  async getIssues(workspace: string, project: string): Promise<WorkItem[]> { return list(await this.request(`/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/`)); }

  private reviewPath(workspace: string, project: string, issue: string, suffix: "session" | "assets"): string {
    return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/freeframe-review-${suffix}/`;
  }

  async getReviewSession(workspace: string, project: string, issue: string): Promise<ReviewSessionState> {
    const body = record(await this.request<unknown>(this.reviewPath(workspace, project, issue, "session"), {}, true));
    if (body && "error" in body) {
      if (typeof body.can_manage !== "boolean") throw new PlaneError("Plane returned an invalid unlinked state", 502, body);
      return { linked: false, can_manage: body.can_manage };
    }
    if (!body || !nonEmptyString(body.asset_id) || !nonEmptyString(body.integration_token) || !Number.isInteger(body.expires_in) || (body.expires_in as number) <= 0 || typeof body.can_manage !== "boolean") {
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
    return list(await this.request(path));
  }
  async createAsset(workspace: string, project: string, issue: string, name: string): Promise<ReviewAsset> {
    return await this.request<ReviewAsset>(this.reviewPath(workspace, project, issue, "assets"), { method: "POST", body: JSON.stringify({ name, asset_type: "video", description: null }) }) as ReviewAsset;
  }
  async linkAsset(workspace: string, project: string, issue: string, assetId: string): Promise<void> {
    await this.request(this.reviewPath(workspace, project, issue, "session"), { method: "PUT", body: JSON.stringify({ asset_id: assetId }) });
  }
  async unlinkAsset(workspace: string, project: string, issue: string): Promise<void> {
    await this.request(this.reviewPath(workspace, project, issue, "session"), { method: "DELETE" });
  }
}
