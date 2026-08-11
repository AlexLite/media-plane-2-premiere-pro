import { describe, expect, it, vi } from "vitest";
import { collectDiagnostics, diagnosticReportText } from "../src/diagnostics";

const binding = {
  projectGuid: "project-secret-guid",
  sequenceId: "sequence-secret-guid",
  baseUrl: "https://plane-secret.example.test",
  workspaceSlug: "workspace-secret",
  projectId: "project-secret-id",
  workItemId: "issue-secret-id",
};

function host() {
  const sequence = { getPlayerPosition: vi.fn(), getEndTime: vi.fn() };
  const markerCollection = {
    getMarkers: vi.fn(),
    createAddMarkerAction: vi.fn(),
    createMoveMarkerAction: vi.fn(),
    createRemoveMarkerAction: vi.fn(),
  };
  const project = { getActiveSequence: vi.fn().mockResolvedValue(sequence), executeTransaction: vi.fn(), lockedAccess: vi.fn() };
  return {
    sequence,
    runtime: () => ({
      Project: { getActiveProject: vi.fn().mockResolvedValue(project) },
      Markers: { getMarkers: vi.fn().mockResolvedValue(markerCollection) },
      TickTime: { createWithSeconds: vi.fn() },
      EncoderManager: { getManager: vi.fn(), getExportFileExtension: vi.fn() },
      Constants: { ExportType: { IMMEDIATELY: 1 } },
    }),
  };
}

function storageRuntime() {
  return { storage: {
    secureStorage: { getItem: vi.fn(), setItem: vi.fn() },
    localFileSystem: { getFileForOpening: vi.fn(), getFileForSaving: vi.fn() },
  } };
}

describe("redacted integration diagnostics", () => {
  it("reports a linked ready review without exposing private context", async () => {
    const { runtime } = host();
    const sessions = { clear: vi.fn() };
    const report = await collectDiagnostics({
      premiere: {
        context: vi.fn().mockResolvedValue({ status: "ready", sequence: { projectGuid: binding.projectGuid, id: binding.sequenceId, name: "Secret sequence", durationSeconds: 10 } }),
        supportsDirectExport: vi.fn().mockReturnValue(true),
      } as any,
      store: { get: vi.fn().mockReturnValue(binding), getToken: vi.fn().mockResolvedValue("plane-secret-token") } as any,
      premiereRuntime: runtime,
      uxpRuntime: storageRuntime,
      planeFactory: () => ({ validate: vi.fn().mockResolvedValue({}), getWorkItem: vi.fn().mockResolvedValue({}) }) as any,
      sessionsFactory: () => sessions as any,
      loadReview: vi.fn().mockResolvedValue({
        linked: true,
        asset: { id: "asset-secret", name: "Secret asset", asset_type: "video" },
        versions: [{ id: "version-secret", version_number: 1, processing_status: "ready", created_at: null, duration_seconds: 10, fps_numerator: 30000, fps_denominator: 1001 }],
        permissions: { read: true, comment: true, upload: false, manage: false },
      }),
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });
    expect(report.summary.fail).toBe(0);
    expect(report.checks.find(check => check.id === "review.ready")?.value).toBe(1);
    expect(report.checks.find(check => check.id === "review.timing")?.value).toBe(1);
    expect(sessions.clear).toHaveBeenCalledOnce();
    const text = diagnosticReportText(report);
    for (const secret of ["plane-secret-token", binding.baseUrl, binding.projectGuid, binding.sequenceId, binding.projectId, binding.workItemId, "asset-secret", "version-secret", "Secret sequence", "Secret asset"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("treats a controlled unlinked work item as a warning", async () => {
    const { runtime } = host();
    const report = await collectDiagnostics({
      premiere: { context: vi.fn().mockResolvedValue({ status: "ready", sequence: { projectGuid: binding.projectGuid, id: binding.sequenceId, name: "Sequence", durationSeconds: 10 } }), supportsDirectExport: vi.fn().mockReturnValue(true) } as any,
      store: { get: vi.fn().mockReturnValue(binding), getToken: vi.fn().mockResolvedValue("token") } as any,
      premiereRuntime: runtime,
      uxpRuntime: storageRuntime,
      planeFactory: () => ({ validate: vi.fn().mockResolvedValue({}), getWorkItem: vi.fn().mockResolvedValue({}) }) as any,
      sessionsFactory: () => ({ clear: vi.fn() }) as any,
      loadReview: vi.fn().mockResolvedValue({ linked: false, canManage: true }),
    });
    expect(report.checks.find(check => check.id === "review.link")).toMatchObject({ status: "warn", value: false });
    expect(report.checks.find(check => check.id === "review.versions")?.status).toBe("skip");
  });

  it("never copies raw exception details into the report", async () => {
    const raw = "token=super-secret https://secret.example/C:/media/private.mov";
    const report = await collectDiagnostics({
      premiere: { context: vi.fn().mockRejectedValue(new Error(raw)), supportsDirectExport: vi.fn().mockReturnValue(false) } as any,
      premiereRuntime: () => { throw new Error(raw); },
      uxpRuntime: () => { throw new Error(raw); },
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });
    const text = diagnosticReportText(report);
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("secret.example");
    expect(text).not.toContain("private.mov");
  });
});
