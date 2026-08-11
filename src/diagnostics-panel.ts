import { ACTIVE_CONTEXT_EVENT } from "./active-context";
import { collectDiagnostics, diagnosticReportText, type DiagnosticCheckId, type DiagnosticGroup, type DiagnosticReport, type DiagnosticStatus } from "./diagnostics";
import { normalizeShellView, SHELL_VIEW_EVENT } from "./shell-events";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { st, type ShellMessageKey } from "./shell-locale";

const root = document.querySelector<HTMLDivElement>("#diagnostics-app");
let report: DiagnosticReport | undefined;
let busy = false;
let notice: "copied" | "copy-error" | undefined;
let started = false;

const checkLabels: Record<DiagnosticCheckId, ShellMessageKey> = {
  "host.project": "checkHostProject",
  "host.sequence": "checkHostSequence",
  "host.duration": "checkHostDuration",
  "host.playhead": "checkHostPlayhead",
  "host.export": "checkHostExport",
  "host.markers": "checkHostMarkers",
  "host.marker-actions": "checkHostMarkerActions",
  "host.transaction": "checkHostTransaction",
  "host.locked-access": "checkHostLockedAccess",
  "host.tick-time": "checkHostTickTime",
  "storage.secure": "checkStorageSecure",
  "storage.files": "checkStorageFiles",
  "binding.present": "checkBindingPresent",
  "binding.credential": "checkBindingCredential",
  "plane.identity": "checkPlaneIdentity",
  "plane.work-item": "checkPlaneWorkItem",
  "review.link": "checkReviewLink",
  "review.versions": "checkReviewVersions",
  "review.ready": "checkReviewReady",
  "review.timing": "checkReviewTiming",
  "scope.read": "checkScopeRead",
  "scope.comment": "checkScopeComment",
  "scope.upload": "checkScopeUpload",
  "scope.manage": "checkScopeManage",
};
const groupLabels: Record<DiagnosticGroup, ShellMessageKey> = {
  host: "diagnosticHostGroup",
  storage: "diagnosticStorageGroup",
  binding: "diagnosticBindingGroup",
  review: "diagnosticReviewGroup",
};
const statusLabels: Record<DiagnosticStatus, ShellMessageKey> = {
  pass: "diagnosticPass",
  warn: "diagnosticWarn",
  fail: "diagnosticFail",
  skip: "diagnosticSkip",
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function valueLabel(value: boolean | number | string | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "✓" : "—";
  return String(value);
}

function renderChecks(): string {
  if (!report) return "";
  return (Object.keys(groupLabels) as DiagnosticGroup[]).map(group => {
    const items = report!.checks.filter(check => check.group === group).map(check => `<div class="diagnostic-check"><span class="diagnostic-dot ${check.status}"></span><div><strong>${escape(st(checkLabels[check.id]))}</strong><span>${escape(st(statusLabels[check.status]))}</span></div><b>${escape(valueLabel(check.value))}</b></div>`).join("");
    return `<section class="diagnostic-group"><h3>${escape(st(groupLabels[group]))}</h3>${items}</section>`;
  }).join("");
}

function render(): void {
  if (!root) return;
  const summary = report ? `<div class="diagnostic-summary"><strong>${escape(st("diagnosticsSummary"))}</strong><span class="pass">${escape(st("diagnosticPass"))}: ${report.summary.pass}</span><span class="warn">${escape(st("diagnosticWarn"))}: ${report.summary.warn}</span><span class="fail">${escape(st("diagnosticFail"))}: ${report.summary.fail}</span><span class="skip">${escape(st("diagnosticSkip"))}: ${report.summary.skip}</span></div>` : "";
  const feedback = busy ? `<p class="status">${escape(st("diagnosticsRefreshing"))}</p>` : notice === "copied" ? `<p class="notice">${escape(st("diagnosticsCopied"))}</p>` : notice === "copy-error" ? `<p class="error">${escape(st("diagnosticsCopyError"))}</p>` : "";
  const reportText = report ? diagnosticReportText(report) : "";
  root.innerHTML = `<section class="diagnostics-surface"><div class="diagnostics-heading"><div><h2>${escape(st("diagnosticsTitle"))}</h2><p>${escape(st("diagnosticsIntro"))}</p></div><button class="secondary compact" data-diagnostic-action="refresh"${busy ? " disabled" : ""}>${escape(st("diagnosticsRefresh"))}</button></div>${feedback}${summary}<div class="diagnostic-groups">${renderChecks()}</div><div class="diagnostic-report"><label for="diagnosticReport">${escape(st("diagnosticsReport"))}</label><textarea id="diagnosticReport" readonly>${escape(reportText)}</textarea><p class="hint">${escape(st("diagnosticsSafeHint"))}</p><button class="secondary" data-diagnostic-action="copy"${!report || busy ? " disabled" : ""}>${escape(st("diagnosticsCopy"))}</button></div></section>`;
}

async function run(): Promise<void> {
  if (busy) return;
  busy = true; notice = undefined; render();
  try { report = await collectDiagnostics(); }
  finally { busy = false; render(); }
}

async function copyReport(): Promise<void> {
  if (!report) return;
  const text = diagnosticReportText(report);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const field = root?.querySelector<HTMLTextAreaElement>("#diagnosticReport");
      field?.select();
      if (!document.execCommand("copy")) throw new Error();
    }
    notice = "copied";
  } catch { notice = "copy-error"; }
  render();
}

root?.addEventListener("click", event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-diagnostic-action]")?.dataset.diagnosticAction;
  if (action === "refresh") void run();
  if (action === "copy") void copyReport();
});
window.addEventListener(SHELL_VIEW_EVENT, event => {
  if (normalizeShellView((event as CustomEvent<unknown>).detail) === "diagnostics" && !started) {
    started = true;
    void run();
  }
});
window.addEventListener(INTERFACE_LOCALE_EVENT, render);
window.addEventListener(ACTIVE_CONTEXT_EVENT, () => { if (started) void run(); });

render();
if (document.body.dataset.activeView === "diagnostics") { started = true; void run(); }
