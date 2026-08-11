import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectFreeFrameClient, directReviewVersion } from "../src/direct-freeframe-client";
import { directLocaleKeys, dt } from "../src/direct-locale";
import { DirectFreeFrameStore } from "../src/persistence";

const ids = { user: "11111111-1111-4111-8111-111111111111", project: "22222222-2222-4222-8222-222222222222" };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());

describe("direct FreeFrame mode", () => {
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
    await expect(client.pollDeviceAuthorization("device-secret")).resolves.toBeUndefined();
    await expect(client.pollDeviceAuthorization("device-secret")).resolves.toMatchObject({ refresh_token: "refresh-browser" });
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
