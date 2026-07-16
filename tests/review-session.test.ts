import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SequenceBinding } from "../src/domain";
import { FreeFrameClient, normalizeFreeFrameApiUrl } from "../src/freeframe-client";
import { BindingStore } from "../src/persistence";
import { PlaneClient } from "../src/plane-client";
import { ReviewSessionManager } from "../src/review-session";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  issue: "33333333-3333-4333-8333-333333333333",
  asset: "44444444-4444-4444-8444-444444444444",
  shadowUser: "55555555-5555-4555-8555-555555555555",
  planeUser: "66666666-6666-4666-8666-666666666666",
} as const;
const planeReviewSessionFixture = {
  asset_id: ids.asset,
  integration_token: "plane-integration-token",
  expires_in: 300,
  can_manage: false,
  freeframe_api_url: "https://freeframe.test/api/",
} as const;
const freeFrameSessionFixture = {
  access_token: "memory-only-access-token",
  token_type: "bearer",
  expires_in: 300,
  user: { id: ids.shadowUser, plane_user_id: ids.planeUser, email: "editor@example.test", name: "Review Editor" },
  context: { workspace_id: ids.workspace, project_id: ids.project, issue_id: ids.issue },
  scopes: ["review:read", "review:comment"] as const,
} as const;
const binding: SequenceBinding = { projectGuid: "premiere-project", sequenceId: "sequence", baseUrl: "https://plane.test", workspaceSlug: "workspace", projectId: ids.project, workItemId: ids.issue };

const values = new Map<string, string>();
const secrets = new Map<string, ArrayBuffer>();
const localStorageMock: Storage = {
  get length() { return values.size; }, clear: () => values.clear(), getItem: key => values.get(key) ?? null,
  key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
};
const secureStorage = {
  getItem: vi.fn(async (key: string) => secrets.get(key)),
  setItem: vi.fn(async (key: string, value: ArrayBuffer) => { secrets.set(key, value); }),
};
const storageRuntime = () => ({ localStorage: localStorageMock, storage: { secureStorage } });
const makeBinding = (projectGuid: string, sequenceId: string): SequenceBinding => ({ ...binding, projectGuid, sequenceId });

beforeEach(() => { values.clear(); secrets.clear(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("trusted Plane and FreeFrame session contracts", () => {
  it("accepts and normalizes the server-controlled Plane endpoint fixture", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(planeReviewSessionFixture) }));
    await expect(new PlaneClient("https://plane.test", "pat").getReviewSession("workspace", ids.project, ids.issue)).resolves.toEqual({
      linked: true,
      session: { ...planeReviewSessionFixture, freeframe_api_url: "https://freeframe.test/api" },
    });
  });

  it("rejects a missing or unsafe Plane-discovered endpoint", async () => {
    for (const freeframe_api_url of [undefined, "http://freeframe.test", "https://user:secret@freeframe.test", "https://freeframe.test?token=bad"]) {
      const body = { ...planeReviewSessionFixture, freeframe_api_url };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) }));
      await expect(new PlaneClient("https://plane.test", "pat").getReviewSession("workspace", ids.project, ids.issue)).rejects.toThrow("trusted FreeFrame API URL");
    }
  });

  it("normalizes only absolute HTTPS FreeFrame API bases", () => {
    expect(normalizeFreeFrameApiUrl("https://freeframe.test/api/")).toBe("https://freeframe.test/api");
    for (const value of ["http://localhost:8000", "https://freeframe.test/api#fragment", " https://freeframe.test", "freeframe.test"]) {
      expect(() => normalizeFreeFrameApiUrl(value)).toThrow();
    }
  });

  it("accepts the FreeFrame exchange fixture only for the exact Plane context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(freeFrameSessionFixture) }));
    const session = await new FreeFrameClient("https://freeframe.test/api").exchange("integration", { projectId: ids.project, issueId: ids.issue });
    expect(session.context).toEqual(freeFrameSessionFixture.context);
    expect(session.scopes).toEqual(["review:read", "review:comment"]);
  });

  it("fails closed on unknown scopes or mismatched context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ ...freeFrameSessionFixture, scopes: ["review:read", "admin:all"] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(freeFrameSessionFixture) }));
    const client = new FreeFrameClient("https://freeframe.test");
    await expect(client.exchange("integration", { projectId: ids.project, issueId: ids.issue })).rejects.toThrow("invalid scopes");
    await expect(client.exchange("integration", { projectId: ids.project, issueId: "77777777-7777-4777-8777-777777777777" })).rejects.toThrow("mismatched review context");
  });
});

describe("review session lifecycle", () => {
  it("renews through Plane after expiry and keeps the FreeFrame token in memory", async () => {
    let now = 1_000;
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: true, session: { ...planeReviewSessionFixture, expires_in: 10 } }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ...freeFrameSessionFixture, expires_in: 10 }) }));
    const manager = new ReviewSessionManager(plane as any, () => now);
    await manager.get(binding); await manager.get(binding);
    expect(plane.getReviewSession).toHaveBeenCalledTimes(1);
    now = 7_000; await manager.get(binding);
    expect(plane.getReviewSession).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a scoped session for another Plane work item", async () => {
    const otherIssue = "77777777-7777-4777-8777-777777777777";
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: true, session: planeReviewSessionFixture }) };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(freeFrameSessionFixture) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ ...freeFrameSessionFixture, context: { ...freeFrameSessionFixture.context, issue_id: otherIssue } }) }));
    const manager = new ReviewSessionManager(plane as any);
    await manager.get(binding);
    await manager.get({ ...binding, workItemId: otherIssue });
    expect(plane.getReviewSession).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Plane changes the endpoint for the same bound context", async () => {
    let now = 0;
    const plane = { getReviewSession: vi.fn()
      .mockResolvedValueOnce({ linked: true, session: { ...planeReviewSessionFixture, expires_in: 10 } })
      .mockResolvedValueOnce({ linked: true, session: { ...planeReviewSessionFixture, expires_in: 10, freeframe_api_url: "https://other-freeframe.test" } }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ...freeFrameSessionFixture, expires_in: 10 }) }));
    const manager = new ReviewSessionManager(plane as any, () => now);
    await manager.get(binding);
    now = 6_000;
    await expect(manager.get(binding)).rejects.toThrow("different FreeFrame API endpoint");
  });

  it("fails closed when Plane and FreeFrame disagree about manage permission", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: true, session: { ...planeReviewSessionFixture, can_manage: true } }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(freeFrameSessionFixture) }));
    await expect(new ReviewSessionManager(plane as any).get(binding)).rejects.toThrow("permissions do not match");
  });
});

describe("sequence binding and secure credential boundary", () => {
  it("restores only the exact project GUID and sequence GUID pair", () => {
    const store = new BindingStore(storageRuntime);
    store.save(makeBinding("project-a", "sequence-a"));
    expect(store.get("project-a", "sequence-a")).toEqual(makeBinding("project-a", "sequence-a"));
    expect(store.get("project-b", "sequence-a")).toBeUndefined();
    expect(store.get("project-a", "sequence-b")).toBeUndefined();
  });

  it("isolates duplicated or replaced sequences and disconnects only locally", () => {
    const store = new BindingStore(storageRuntime);
    store.save(makeBinding("project-a", "sequence-a"));
    store.save(makeBinding("project-a", "sequence-copy"));
    store.disconnect("project-a", "sequence-a");
    expect(store.get("project-a", "sequence-a")).toBeUndefined();
    expect(store.get("project-a", "sequence-copy")).toEqual(makeBinding("project-a", "sequence-copy"));
  });

  it("stores the Plane PAT only through UXP secure storage", async () => {
    const store = new BindingStore(storageRuntime);
    await store.saveToken("https://plane.test", "plane-pat-secret");
    expect(secureStorage.setItem).toHaveBeenCalledTimes(1);
    expect([...values.values()].join("\n")).not.toContain("plane-pat-secret");
    await expect(store.getToken("https://plane.test")).resolves.toBe("plane-pat-secret");
  });
});
