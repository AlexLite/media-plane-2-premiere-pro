import { loadAssetReview, type AssetReviewState } from "./asset-workflow";
import type { SequenceBinding } from "./domain";
import { BindingStore } from "./persistence";
import { PlaneClient } from "./plane-client";
import { PremiereAdapter } from "./premiere";
import { ReviewSessionManager } from "./review-session";

declare const require: (name: string) => any;

export type DiagnosticStatus = "pass" | "warn" | "fail" | "skip";
export type DiagnosticGroup = "host" | "storage" | "binding" | "review";
export type DiagnosticCheckId =
  | "host.project" | "host.sequence" | "host.duration" | "host.playhead" | "host.export"
  | "host.markers" | "host.marker-actions" | "host.transaction" | "host.locked-access" | "host.tick-time"
  | "storage.secure" | "storage.files"
  | "binding.present" | "binding.credential" | "plane.identity" | "plane.work-item"
  | "review.link" | "review.versions" | "review.ready" | "review.timing"
  | "scope.read" | "scope.comment" | "scope.upload" | "scope.manage";

export interface DiagnosticCheck {
  id: DiagnosticCheckId;
  group: DiagnosticGroup;
  status: DiagnosticStatus;
  value?: boolean | number | string;
}

export interface DiagnosticSummary { pass: number; warn: number; fail: number; skip: number }
export interface DiagnosticReport { generatedAt: string; checks: DiagnosticCheck[]; summary: DiagnosticSummary }

export interface DiagnosticDependencies {
  premiere?: PremiereAdapter;
  store?: BindingStore;
  premiereRuntime?: () => any;
  uxpRuntime?: () => any;
  planeFactory?: (baseUrl: string, token: string) => PlaneClient;
  sessionsFactory?: (plane: PlaneClient) => ReviewSessionManager;
  loadReview?: typeof loadAssetReview;
  now?: () => Date;
}

function add(checks: DiagnosticCheck[], id: DiagnosticCheckId, group: DiagnosticGroup, status: DiagnosticStatus, value?: boolean | number | string): void {
  checks.push(value === undefined ? { id, group, status } : { id, group, status, value });
}

function summary(checks: DiagnosticCheck[]): DiagnosticSummary {
  const result: DiagnosticSummary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) result[check.status] += 1;
  return result;
}

function skipBindingNetwork(checks: DiagnosticCheck[]): void {
  add(checks, "binding.credential", "binding", "skip");
  add(checks, "plane.identity", "binding", "skip");
  add(checks, "plane.work-item", "binding", "skip");
  add(checks, "review.link", "review", "skip");
  skipReviewDetails(checks);
}

function skipReviewDetails(checks: DiagnosticCheck[]): void {
  add(checks, "review.versions", "review", "skip");
  add(checks, "review.ready", "review", "skip");
  add(checks, "review.timing", "review", "skip");
  for (const id of ["scope.read", "scope.comment", "scope.upload", "scope.manage"] as const) add(checks, id, "review", "skip");
}

async function hostDiagnostics(checks: DiagnosticCheck[], premiere: PremiereAdapter, runtime: () => any): Promise<ReturnType<PremiereAdapter["context"]> extends Promise<infer T> ? T : never> {
  let context: Awaited<ReturnType<PremiereAdapter["context"]>>;
  try {
    context = await premiere.context();
  } catch {
    add(checks, "host.project", "host", "fail");
    add(checks, "host.sequence", "host", "skip");
    add(checks, "host.duration", "host", "skip");
    add(checks, "host.playhead", "host", "skip");
    context = { status: "no-project" };
  }

  if (!checks.some(check => check.id === "host.project")) {
    add(checks, "host.project", "host", context.status === "no-project" ? "fail" : "pass");
    add(checks, "host.sequence", "host", context.status === "ready" ? "pass" : context.status === "no-sequence" ? "warn" : "skip");
    add(checks, "host.duration", "host", context.status === "ready" && typeof context.sequence.durationSeconds === "number" ? "pass" : context.status === "ready" ? "warn" : "skip");
  }

  let api: any;
  try { api = runtime(); } catch { api = {}; }
  let project: any;
  let sequence: any;
  if (context.status === "ready") {
    try {
      project = await api.Project?.getActiveProject?.();
      sequence = await project?.getActiveSequence?.();
    } catch { project = undefined; sequence = undefined; }
  }
  if (!checks.some(check => check.id === "host.playhead")) add(checks, "host.playhead", "host", sequence && typeof sequence.getPlayerPosition === "function" ? "pass" : context.status === "ready" ? "fail" : "skip");
  add(checks, "host.export", "host", premiere.supportsDirectExport() ? "pass" : "warn");
  add(checks, "host.transaction", "host", project && typeof project.executeTransaction === "function" ? "pass" : context.status === "ready" ? "fail" : "skip");
  add(checks, "host.locked-access", "host", project && typeof project.lockedAccess === "function" ? "pass" : context.status === "ready" ? "warn" : "skip");
  add(checks, "host.tick-time", "host", typeof api.TickTime?.createWithSeconds === "function" ? "pass" : "fail");

  let markers = false;
  let actions = false;
  if (sequence && typeof api.Markers?.getMarkers === "function") {
    try {
      const collection = await api.Markers.getMarkers(sequence);
      markers = Boolean(collection && typeof collection.getMarkers === "function");
      actions = Boolean(collection
        && typeof collection.createAddMarkerAction === "function"
        && typeof collection.createMoveMarkerAction === "function"
        && typeof collection.createRemoveMarkerAction === "function");
    } catch { markers = false; actions = false; }
  }
  add(checks, "host.markers", "host", markers ? "pass" : context.status === "ready" ? "fail" : "skip");
  add(checks, "host.marker-actions", "host", actions ? "pass" : markers ? "fail" : "skip");
  return context;
}

function storageDiagnostics(checks: DiagnosticCheck[], runtime: () => any): void {
  let value: any;
  try { value = runtime(); } catch { value = {}; }
  const secure = value.storage?.secureStorage;
  const files = value.storage?.localFileSystem;
  add(checks, "storage.secure", "storage", secure && typeof secure.getItem === "function" && typeof secure.setItem === "function" ? "pass" : "fail");
  add(checks, "storage.files", "storage", files && typeof files.getFileForOpening === "function" && typeof files.getFileForSaving === "function" ? "pass" : "fail");
}

function reviewDiagnostics(checks: DiagnosticCheck[], review: AssetReviewState): void {
  if (!review.linked) {
    add(checks, "review.link", "review", "warn", false);
    skipReviewDetails(checks);
    return;
  }
  add(checks, "review.link", "review", "pass", true);
  const versions = review.versions.length;
  const ready = review.versions.filter(version => version.processing_status === "ready").length;
  const timing = review.versions.filter(version => version.processing_status === "ready"
    && typeof version.duration_seconds === "number"
    && typeof version.fps_numerator === "number"
    && typeof version.fps_denominator === "number").length;
  add(checks, "review.versions", "review", versions > 0 ? "pass" : "warn", versions);
  add(checks, "review.ready", "review", ready > 0 ? "pass" : "warn", ready);
  add(checks, "review.timing", "review", timing > 0 ? "pass" : "warn", timing);
  add(checks, "scope.read", "review", "pass", review.permissions.read);
  add(checks, "scope.comment", "review", "pass", review.permissions.comment);
  add(checks, "scope.upload", "review", "pass", review.permissions.upload);
  add(checks, "scope.manage", "review", "pass", review.permissions.manage);
}

export async function collectDiagnostics(dependencies: DiagnosticDependencies = {}): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const premiere = dependencies.premiere ?? new PremiereAdapter();
  const store = dependencies.store ?? new BindingStore();
  const premiereRuntime = dependencies.premiereRuntime ?? (() => require("premierepro"));
  const uxpRuntime = dependencies.uxpRuntime ?? (() => require("uxp"));
  const planeFactory = dependencies.planeFactory ?? ((baseUrl, token) => new PlaneClient(baseUrl, token));
  const sessionsFactory = dependencies.sessionsFactory ?? (plane => new ReviewSessionManager(plane));
  const loadReview = dependencies.loadReview ?? loadAssetReview;
  const context = await hostDiagnostics(checks, premiere, premiereRuntime);
  storageDiagnostics(checks, uxpRuntime);

  if (context.status !== "ready") {
    add(checks, "binding.present", "binding", "skip");
    skipBindingNetwork(checks);
    return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
  }

  let binding: SequenceBinding | undefined;
  try { binding = store.get(context.sequence.projectGuid, context.sequence.id); } catch { binding = undefined; }
  add(checks, "binding.present", "binding", binding ? "pass" : "warn", Boolean(binding));
  if (!binding) {
    skipBindingNetwork(checks);
    return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
  }

  let token: string | undefined;
  try { token = await store.getToken(binding.baseUrl); } catch { token = undefined; }
  add(checks, "binding.credential", "binding", token ? "pass" : "fail", Boolean(token));
  if (!token) {
    add(checks, "plane.identity", "binding", "skip");
    add(checks, "plane.work-item", "binding", "skip");
    add(checks, "review.link", "review", "skip");
    skipReviewDetails(checks);
    return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
  }

  const plane = planeFactory(binding.baseUrl, token);
  try {
    await plane.validate();
    add(checks, "plane.identity", "binding", "pass");
  } catch {
    add(checks, "plane.identity", "binding", "fail");
    add(checks, "plane.work-item", "binding", "skip");
    add(checks, "review.link", "review", "skip");
    skipReviewDetails(checks);
    return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
  }

  try {
    await plane.getWorkItem(binding.workspaceSlug, binding.projectId, binding.workItemId);
    add(checks, "plane.work-item", "binding", "pass");
  } catch {
    add(checks, "plane.work-item", "binding", "fail");
    add(checks, "review.link", "review", "skip");
    skipReviewDetails(checks);
    return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
  }

  const sessions = sessionsFactory(plane);
  try {
    reviewDiagnostics(checks, await loadReview(binding, plane, sessions));
  } catch {
    add(checks, "review.link", "review", "fail");
    skipReviewDetails(checks);
  } finally {
    sessions.clear();
  }
  return { generatedAt: (dependencies.now?.() ?? new Date()).toISOString(), checks, summary: summary(checks) };
}

export function diagnosticReportText(report: DiagnosticReport): string {
  return JSON.stringify({
    schema: "plane-freeframe-diagnostics-v1",
    generatedAt: report.generatedAt,
    summary: report.summary,
    checks: report.checks.map(check => ({ id: check.id, status: check.status, ...(check.value === undefined ? {} : { value: check.value }) })),
  }, null, 2);
}
