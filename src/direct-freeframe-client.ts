import type { ReviewComment, ReviewVersion } from "./domain";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { FreeFrameError, normalizeFreeFrameApiUrl, parseComment, type ReviewCommentCreateInput } from "./freeframe-client";

export interface DirectTokens { access_token: string; refresh_token: string; token_type: "bearer" }
export interface DeviceAuthorization { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number }
export interface DirectUser { id: string; email: string; name: string }
export interface DirectProject { id: string; name: string; description: string | null; asset_count: number; role: string | null }
export interface DirectMediaFile { duration_seconds: number | null; fps: number | null }
export interface DirectVersion { id: string; asset_id: string; version_number: number; processing_status: string; created_at: string; files: DirectMediaFile[] }
export interface DirectAsset { id: string; project_id: string; name: string; asset_type: string; status: string; latest_version: DirectVersion | null }
export interface DirectSessionHooks {
  getRefreshToken(): Promise<string | undefined>;
  onTokens(tokens: DirectTokens): Promise<void>;
  onSessionExpired?(): Promise<void> | void;
}

function canonicalFps(value: number | null): { numerator: number; denominator: number } | undefined {
  if (value === null) return undefined;
  const integer = Math.round(value);
  if (Math.abs(value - integer) < 0.0001) return { numerator: integer, denominator: 1 };
  for (const candidate of [{ value: 24000 / 1001, numerator: 24000 }, { value: 30000 / 1001, numerator: 30000 }, { value: 48000 / 1001, numerator: 48000 }, { value: 60000 / 1001, numerator: 60000 }, { value: 120000 / 1001, numerator: 120000 }]) {
    if (Math.abs(value - candidate.value) < 0.001) return { numerator: candidate.numerator, denominator: 1001 };
  }
  return undefined;
}

export function directReviewVersion(value: DirectVersion): ReviewVersion {
  const media = value.files[0];
  const fps = canonicalFps(media?.fps ?? null);
  return { id: value.id, version_number: value.version_number, processing_status: value.processing_status, created_at: value.created_at, duration_seconds: media?.duration_seconds ?? null, fps_numerator: fps?.numerator ?? null, fps_denominator: fps?.denominator ?? null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const id = (value: unknown): value is string => text(value) && UUID.test(value);

function tokens(value: unknown): DirectTokens {
  const body = object(value);
  if (!body || !text(body.access_token) || !text(body.refresh_token) || body.token_type !== "bearer") throw new FreeFrameError("FreeFrame returned an invalid login response", 502);
  return { access_token: body.access_token, refresh_token: body.refresh_token, token_type: "bearer" };
}
function deviceAuthorization(value: unknown): DeviceAuthorization {
  const body = object(value);
  if (!body || !text(body.device_code) || !text(body.user_code) || !text(body.verification_uri) || !integer(body.expires_in) || !integer(body.interval)) throw new FreeFrameError("FreeFrame returned an invalid device authorization response", 502);
  let verification: URL;
  let complete: URL | undefined;
  try { verification = new URL(body.verification_uri); if (text(body.verification_uri_complete)) complete = new URL(body.verification_uri_complete); } catch { throw new FreeFrameError("FreeFrame returned an invalid device verification URL", 502); }
  if (verification.protocol !== "https:" || (complete && complete.protocol !== "https:") || body.expires_in <= 0 || body.interval <= 0) throw new FreeFrameError("FreeFrame returned an invalid device authorization response", 502);
  return { device_code: body.device_code, user_code: body.user_code, verification_uri: verification.toString(), verification_uri_complete: complete?.toString(), expires_in: body.expires_in, interval: body.interval };
}
function user(value: unknown): DirectUser {
  const body = object(value);
  if (!body || !id(body.id) || !text(body.email) || !text(body.name)) throw new FreeFrameError("FreeFrame returned an invalid user", 502);
  return { id: body.id, email: body.email, name: body.name };
}
function project(value: unknown): DirectProject {
  const body = object(value);
  if (!body || !id(body.id) || !text(body.name) || !Number.isInteger(body.asset_count)) throw new FreeFrameError("FreeFrame returned an invalid project", 502);
  return { id: body.id, name: body.name, description: typeof body.description === "string" ? body.description : null, asset_count: body.asset_count as number, role: typeof body.role === "string" ? body.role : null };
}
function mediaFile(value: unknown): DirectMediaFile {
  const body = object(value);
  if (!body) throw new FreeFrameError("FreeFrame returned invalid media metadata", 502);
  const duration = typeof body.duration_seconds === "number" && Number.isFinite(body.duration_seconds) && body.duration_seconds >= 0 ? body.duration_seconds : null;
  const fps = typeof body.fps === "number" && Number.isFinite(body.fps) && body.fps > 0 ? body.fps : null;
  return { duration_seconds: duration, fps };
}
function version(value: unknown): DirectVersion {
  const body = object(value);
  if (!body || !id(body.id) || !id(body.asset_id) || !Number.isInteger(body.version_number) || !text(body.processing_status) || !text(body.created_at) || !Array.isArray(body.files)) throw new FreeFrameError("FreeFrame returned an invalid version", 502);
  return { id: body.id, asset_id: body.asset_id, version_number: body.version_number as number, processing_status: body.processing_status, created_at: body.created_at, files: body.files.map(mediaFile) };
}
function asset(value: unknown): DirectAsset {
  const body = object(value);
  if (!body || !id(body.id) || !id(body.project_id) || !text(body.name) || !text(body.asset_type) || !text(body.status)) throw new FreeFrameError("FreeFrame returned an invalid asset", 502);
  return { id: body.id, project_id: body.project_id, name: body.name, asset_type: body.asset_type, status: body.status, latest_version: body.latest_version === null || body.latest_version === undefined ? null : version(body.latest_version) };
}

export class DirectFreeFrameClient {
  readonly root: string;
  private accessToken = "";
  private refreshInFlight?: Promise<void>;
  constructor(root: string, private readonly sessionHooks?: DirectSessionHooks) { this.root = normalizeFreeFrameApiUrl(root); }
  private async parse(response: Response): Promise<unknown> {
    const raw = await response.text();
    let body: unknown;
    if (raw) try { body = JSON.parse(raw); } catch { throw new FreeFrameError("FreeFrame returned invalid JSON", 502); }
    if (!response.ok) throw new FreeFrameError("FreeFrame request failed", response.status);
    return body;
  }
  private async publicPost(path: string, body: unknown): Promise<unknown> {
    return this.parse(await fetchWithTimeout(`${this.root}${path}`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  }
  private async devicePost(path: string, body: unknown): Promise<unknown> {
    return this.parse(await fetchWithTimeout(`${this.root}${path}`, { method: "POST", credentials: "omit", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  }
  private async renewSession(): Promise<void> {
    if (!this.sessionHooks) throw new FreeFrameError("FreeFrame session expired", 401);
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        const refreshToken = await this.sessionHooks!.getRefreshToken();
        if (!refreshToken) throw new FreeFrameError("Refresh token is missing", 401);
        const result = tokens(await this.publicPost("/auth/refresh", { refresh_token: refreshToken }));
        this.accessToken = result.access_token;
        await this.sessionHooks!.onTokens(result);
      })().finally(() => { this.refreshInFlight = undefined; });
    }
    try { await this.refreshInFlight; }
    catch (error) { this.clearSession(); await this.sessionHooks.onSessionExpired?.(); throw error; }
  }
  private async request(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
    if (!this.accessToken) throw new FreeFrameError("FreeFrame session is missing", 401);
    const response = await fetchWithTimeout(`${this.root}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    if (response.status === 401 && retry && this.sessionHooks) { await this.renewSession(); return this.request(path, init, false); }
    if (response.status === 401 && this.sessionHooks) { this.clearSession(); await this.sessionHooks.onSessionExpired?.(); }
    return this.parse(response);
  }
  async login(email: string, password: string): Promise<DirectTokens> {
    if (!email.trim() || !password) throw new FreeFrameError("Email and password are required", 400);
    const result = tokens(await this.publicPost("/auth/login", { email: email.trim(), password }));
    this.accessToken = result.access_token;
    return result;
  }
  /** Browser/device authorization contract: POST /auth/device/start then poll /auth/device/poll. */
  async startDeviceAuthorization(): Promise<DeviceAuthorization> { return deviceAuthorization(await this.devicePost("/auth/device/start", { client_id: "premiere-uxp" })); }
  async pollDeviceAuthorization(deviceCode: string): Promise<DirectTokens | undefined> {
    if (!deviceCode) throw new FreeFrameError("Device code is missing", 400);
    const response = await fetchWithTimeout(`${this.root}/auth/device/poll`, { method: "POST", credentials: "omit", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ device_code: deviceCode, client_id: "premiere-uxp" }) });
    const raw = await response.text();
    let body: unknown;
    if (raw) try { body = JSON.parse(raw); } catch { throw new FreeFrameError("FreeFrame returned invalid JSON", 502); }
    const error = object(body)?.error;
    if ((response.status === 202 || response.status === 400 || response.status === 428) && (error === "authorization_pending" || error === "slow_down" || response.status === 202 || response.status === 428)) return undefined;
    if (!response.ok) throw new FreeFrameError("FreeFrame device authorization failed", response.status);
    const result = tokens(body);
    this.accessToken = result.access_token;
    return result;
  }
  async refresh(refreshToken: string): Promise<DirectTokens> {
    if (!refreshToken) throw new FreeFrameError("Refresh token is missing", 401);
    const result = tokens(await this.publicPost("/auth/refresh", { refresh_token: refreshToken }));
    this.accessToken = result.access_token;
    return result;
  }
  clearSession(): void { this.accessToken = ""; }
  async me(): Promise<DirectUser> { return user(await this.request("/auth/me")); }
  async projects(): Promise<DirectProject[]> { const body = await this.request("/projects"); if (!Array.isArray(body)) throw new FreeFrameError("FreeFrame returned invalid projects", 502); return body.map(project); }
  async assets(projectId: string): Promise<DirectAsset[]> { if (!id(projectId)) throw new FreeFrameError("Project ID is invalid", 400); const body = await this.request(`/projects/${encodeURIComponent(projectId)}/assets`); if (!Array.isArray(body)) throw new FreeFrameError("FreeFrame returned invalid assets", 502); return body.map(asset); }
  async versions(assetId: string): Promise<DirectVersion[]> { if (!id(assetId)) throw new FreeFrameError("Asset ID is invalid", 400); const body = await this.request(`/assets/${encodeURIComponent(assetId)}/versions`); if (!Array.isArray(body)) throw new FreeFrameError("FreeFrame returned invalid versions", 502); return body.map(version); }
  async comments(assetId: string, versionId: string, signal?: AbortSignal): Promise<ReviewComment[]> { const body = await this.request(`/assets/${encodeURIComponent(assetId)}/comments?version_id=${encodeURIComponent(versionId)}`, { signal }); if (!Array.isArray(body)) throw new FreeFrameError("FreeFrame returned invalid comments", 502); return body.map(item => parseComment(item, assetId, versionId)); }
  async createComment(assetId: string, versionId: string, input: ReviewCommentCreateInput, signal?: AbortSignal): Promise<ReviewComment> { const body = input.body.trim(); if (!body) throw new FreeFrameError("Comment is empty", 400); return parseComment(await this.request(`/assets/${encodeURIComponent(assetId)}/comments`, { method: "POST", body: JSON.stringify({ ...input, body, version_id: versionId }), signal }), assetId, versionId); }
  async toggleResolved(assetId: string, versionId: string, commentId: string, signal?: AbortSignal): Promise<ReviewComment> { return parseComment(await this.request(`/comments/${encodeURIComponent(commentId)}/resolve`, { method: "POST", signal }), assetId, versionId); }
}
