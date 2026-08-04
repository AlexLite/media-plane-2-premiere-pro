import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectFreeFrameClient } from "../src/direct-freeframe-client";
import { directLocaleKeys, dt } from "../src/direct-locale";
import { DirectFreeFrameStore } from "../src/persistence";

const ids = { user: "11111111-1111-4111-8111-111111111111", project: "22222222-2222-4222-8222-222222222222" };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());

describe("direct FreeFrame mode", () => {
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

  it("keeps Russian and English dictionaries in parity", () => {
    expect(directLocaleKeys("en")).toEqual(directLocaleKeys("ru"));
    expect(dt("serverUrl", "ru")).toBe("URL сервера FreeFrame");
  });
});
