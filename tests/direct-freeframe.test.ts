import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectFreeFrameClient, directApiUrl, directReviewVersion } from "../src/direct-freeframe-client";
import { directLocaleKeys, dt } from "../src/direct-locale";
import { DirectFreeFrameStore } from "../src/persistence";

const ids = { user: "11111111-1111-4111-8111-111111111111", project: "22222222-2222-4222-8222-222222222222" };
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());

describe("direct FreeFrame mode", () => {
  it("uses /api for a hosted FreeFrame UI while keeping an explicit API root", () => {
    expect(directApiUrl("https://freeframe.test")).toBe("https://freeframe.test/api");
    expect(directApiUrl("https://freeframe.test/api/")).toBe("https://freeframe.test/api");
  });
  it("maps common decimal rates to canonical rational timing", () => {
    const mapped = directReviewVersion({ id: "33333333-3333-4333-8333-333333333333", asset_id: "44444444-4444-4444-8444-444444444444", version_number: 1, processing_status: "ready", created_at: "2026-01-01T00:00:00Z", files: [{ duration_seconds: 60, fps: 30000 / 1001 }] });
    expect(mapped).toMatchObject({ duration_seconds: 60, fps_numerator: 30000, fps_denominator: 1001 });
  });
  it("logs in at a manually supplied HTTPS API root and keeps access auth in memory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-secret", refresh_token: "refresh-secret", token_type: "bearer" }))
      .mockResolvedValueOnce(response({ id: ids.user, email: "editor@example.test", name: "Editor" }))
      .mockResolvedValueOnce(response([{ id: ids.project, name: "Film", description: null, asset_count: 2, role: "owner" }]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectFreeFrameClient("https://freeframe.test/api/");
    const session = await client.login("editor@example.test", "password");
    await expect(client.me()).resolves.toMatchObject({ name: "Editor" });
    await expect(client.projects()).resolves.toMatchObject([{ name: "Film" }]);
    expect(session.refresh_token).toBe("refresh-secret");
    expect(fetchMock.mock.calls[0][0]).toBe("https://freeframe.test/api/auth/login");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer access-secret" });
  });

  it("persists only the URL locally and the refresh token in secure storage", async () => {
    const local = new Map<string, string>(), secure = new Map<string, ArrayBuffer>();
    const runtime = () => ({
      localStorage: { get length() { return local.size; }, clear: () => local.clear(), getItem: (key: string) => local.get(key) ?? null, key: (index: number) => [...local.keys()][index] ?? null, removeItem: (key: string) => { local.delete(key); }, setItem: (key: string, value: string) => { local.set(key, value); } } as Storage,
      storage: { secureStorage: { getItem: async (key: string) => secure.get(key), setItem: async (key: string, value: ArrayBuffer) => { secure.set(key, value); }, removeItem: async (key: string) => { secure.delete(key); } } },
    });
    const store = new DirectFreeFrameStore(runtime);
    store.saveUrl("https://freeframe.test");
    await store.saveRefreshToken("https://freeframe.test", "refresh-secret-русский");
    expect([...local.values()]).toEqual(["https://freeframe.test"]);
    await expect(store.getRefreshToken("https://freeframe.test")).resolves.toBe("refresh-secret-русский");
    await store.clearRefreshToken("https://freeframe.test");
    await expect(store.getRefreshToken("https://freeframe.test")).resolves.toBeUndefined();
  });

  it("keeps a FreeFrame asset binding separate for each Premiere sequence", () => {
    const local = new Map<string, string>();
    const runtime = () => ({
      localStorage: { get length() { return local.size; }, clear: () => local.clear(), getItem: (key: string) => local.get(key) ?? null, key: (index: number) => [...local.keys()][index] ?? null, removeItem: (key: string) => { local.delete(key); }, setItem: (key: string, value: string) => { local.set(key, value); } } as Storage,
    });
    const store = new DirectFreeFrameStore(runtime);
    store.saveSequenceBinding({ serverUrl: "https://freeframe.test", projectGuid: "premiere-project", sequenceId: "sequence-a", projectId: ids.project, assetId: "33333333-3333-4333-8333-333333333333" });
    expect(store.getSequenceBinding("https://freeframe.test", "premiere-project", "sequence-a")?.assetId).toBe("33333333-3333-4333-8333-333333333333");
    expect(store.getSequenceBinding("https://freeframe.test", "premiere-project", "sequence-b")).toBeUndefined();
    expect(store.getSequenceBinding("https://other-freeframe.test", "premiere-project", "sequence-a")).toBeUndefined();
  });

  it("uploads a new asset or version through the standard FreeFrame multipart lifecycle", async () => {
    const assetId = "33333333-3333-4333-8333-333333333333", versionId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh", token_type: "bearer" }))
      .mockResolvedValueOnce(response({ upload_id: "upload-id", s3_key: "raw/test.mp4", asset_id: assetId, version_id: versionId }))
      .mockResolvedValueOnce(response({ presigned_url: "https://storage.example/upload", part_number: 1 }))
      .mockResolvedValueOnce(response({}, 200, { ETag: "part-etag" }))
      .mockResolvedValueOnce(response({ status: "processing", asset_id: assetId, version_id: versionId }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectFreeFrameClient("https://freeframe.test/api");
    await client.login("editor@example.test", "password");
    const file = { name: "cut.mp4", type: "video/mp4", size: 4, slice: () => new Blob(["test"], { type: "video/mp4" }) };
    await expect(client.upload(ids.project, "Cut", file)).resolves.toEqual({ assetId, versionId, status: "processing" });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "https://freeframe.test/api/auth/login",
      "https://freeframe.test/api/upload/initiate",
      "https://freeframe.test/api/upload/presign-part",
      "https://storage.example/upload",
      "https://freeframe.test/api/upload/complete",
    ]);
  });

  it("refreshes once and retries an authorized request after 401", async () => {
    let refreshToken = "refresh-old";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-old", refresh_token: refreshToken, token_type: "bearer" }))
      .mockResolvedValueOnce(response({ detail: "expired" }, 401))
      .mockResolvedValueOnce(response({ access_token: "access-new", refresh_token: "refresh-new", token_type: "bearer" }))
      .mockResolvedValueOnce(response([{ id: ids.project, name: "Film", description: null, asset_count: 1, role: "owner" }]));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectFreeFrameClient("https://freeframe.test", {
      getRefreshToken: async () => refreshToken,
      onTokens: async tokens => { refreshToken = tokens.refresh_token; },
    });
    await client.login("editor@example.test", "password");
    await expect(client.projects()).resolves.toMatchObject([{ name: "Film" }]);
    expect(refreshToken).toBe("refresh-new");
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer access-new" });
  });

  it("starts browser device authorization and adopts its approved tokens", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ device_code: "device-secret", user_code: "ABCD-EFGH", verification_uri: "https://freeframe.test/device", verification_uri_complete: "https://freeframe.test/device?code=ABCD-EFGH", expires_in: 600, interval: 5 }))
      .mockResolvedValueOnce(response({ error: "authorization_pending" }, 202))
      .mockResolvedValueOnce(response({ access_token: "access-browser", refresh_token: "refresh-browser", token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectFreeFrameClient("https://freeframe.test");
    await expect(client.startDeviceAuthorization()).resolves.toMatchObject({ user_code: "ABCD-EFGH", verification_uri_complete: "https://freeframe.test/device?code=ABCD-EFGH" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("omit");
    await expect(client.pollDeviceAuthorization("device-secret")).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[1][1] as RequestInit).credentials).toBe("omit");
    await expect(client.pollDeviceAuthorization("device-secret")).resolves.toMatchObject({ refresh_token: "refresh-browser" });
    expect((fetchMock.mock.calls[2][1] as RequestInit).credentials).toBe("omit");
  });

  it("expires the local session when the refreshed token is also rejected", async () => {
    const expired = vi.fn();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access-old", refresh_token: "refresh-old", token_type: "bearer" }))
      .mockResolvedValueOnce(response({ detail: "expired" }, 401))
      .mockResolvedValueOnce(response({ access_token: "access-new", refresh_token: "refresh-new", token_type: "bearer" }))
      .mockResolvedValueOnce(response({ detail: "expired" }, 401)));
    const client = new DirectFreeFrameClient("https://freeframe.test", {
      getRefreshToken: async () => "refresh-old",
      onTokens: async () => undefined,
      onSessionExpired: expired,
    });
    await client.login("editor@example.test", "password");
    await expect(client.projects()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    await expect(client.projects()).rejects.toMatchObject({ status: 401 });
  });

  it("keeps Russian and English dictionaries in parity", () => {
    expect(directLocaleKeys("en")).toEqual(directLocaleKeys("ru"));
    expect(dt("serverUrl", "ru")).toBe("URL сервера FreeFrame");
  });
});
