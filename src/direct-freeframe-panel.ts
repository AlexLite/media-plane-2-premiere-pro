import type { ReviewComment } from "./domain";
import { DirectFreeFrameClient, type DirectAsset, type DirectProject, type DirectUser, type DirectVersion } from "./direct-freeframe-client";
import { dt } from "./direct-locale";
import { normalizeFreeFrameApiUrl } from "./freeframe-client";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { DirectFreeFrameStore } from "./persistence";
import { PremiereAdapter } from "./premiere";
import { normalizeShellMode, normalizeShellView, requestShellView, SHELL_MODE_EVENT, SHELL_VIEW_EVENT, USER_CONFIG_EVENT, type ShellMode, type ShellView } from "./shell-events";

const root = document.querySelector<HTMLDivElement>("#direct-freeframe-app");
const store = new DirectFreeFrameStore();
const premiere = new PremiereAdapter();
let mode: ShellMode = normalizeShellMode(document.body.dataset.activeMode);
let view: ShellView = normalizeShellView(document.body.dataset.activeView);
let client: DirectFreeFrameClient | undefined;
let currentUrl = store.getUrl();
let currentUser: DirectUser | undefined;
let projects: DirectProject[] = [];
let assets: DirectAsset[] = [];
let versions: DirectVersion[] = [];
let comments: ReviewComment[] = [];
let selectedProject = "";
let selectedAsset = "";
let selectedVersion = "";
let busy = false;
let restoring = false;
let error = "";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const option = (value: string, label: string, selected: string) => `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;

function connectionForm(): string {
  return `<section class="direct-card direct-empty"><div class="direct-empty-icon">FF</div><h2>${escape(dt("title"))}</h2><p>${escape(dt("loginRequired"))}</p><button class="compact" data-direct-action="settings">${escape(dt("openSettings"))}</button>${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function selectors(): string {
  return `<section class="direct-card"><div class="direct-identity"><div><strong>${escape(currentUser?.name ?? "")}</strong><span>${escape(currentUser?.email ?? "")}</span></div><button class="secondary compact" data-direct-action="logout">${escape(dt("logout"))}</button></div><label for="directProject">${escape(dt("project"))}</label><select id="directProject"><option value="">${escape(dt("selectProject"))}</option>${projects.map(item => option(item.id, `${item.name} (${item.asset_count})`, selectedProject)).join("")}</select>${projects.length ? "" : `<p class="hint">${escape(dt("emptyProjects"))}</p>`}<label for="directAsset">${escape(dt("asset"))}</label><select id="directAsset"${selectedProject ? "" : " disabled"}><option value="">${escape(dt("selectAsset"))}</option>${assets.map(item => option(item.id, item.name, selectedAsset)).join("")}</select>${selectedProject && !assets.length ? `<p class="hint">${escape(dt("emptyAssets"))}</p>` : ""}<label for="directVersion">${escape(dt("version"))}</label><select id="directVersion"${selectedAsset ? "" : " disabled"}><option value="">${escape(dt("selectVersion"))}</option>${versions.map(item => option(item.id, `v${item.version_number} — ${item.processing_status}`, selectedVersion)).join("")}</select><button class="secondary" data-direct-action="refresh"${busy ? " disabled" : ""}>${escape(dt("refresh"))}</button>${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function review(): string {
  if (!currentUser) return connectionForm();
  const list = comments.length ? comments.map(comment => `<div class="comment-card${comment.resolved ? " resolved" : ""}"><div class="comment-meta"><span>${escape(comment.author?.name ?? comment.guest_author?.name ?? "FreeFrame")}${comment.timecode_start === null ? "" : ` · ${comment.timecode_start.toFixed(2)}s`}</span><button class="compact secondary" data-direct-resolve="${escape(comment.id)}">${escape(dt("resolve"))}</button></div><p>${escape(comment.body)}</p></div>`).join("") : `<p class="hint">${escape(dt("noComments"))}</p>`;
  return `${selectors()}<section class="direct-card"><h2>${escape(dt("reviewTitle"))}</h2>${selectedVersion ? `<div class="comment-composer"><label for="directComment">${escape(dt("comment"))}</label><textarea id="directComment" placeholder="${escape(dt("commentPlaceholder"))}"></textarea><button data-direct-action="comment"${busy ? " disabled" : ""}>${escape(dt("addComment"))}</button></div><div class="comment-list">${list}</div>` : `<p>${escape(dt("selectVersion"))}</p>`}</section>`;
}

function media(): string { return currentUser ? selectors() : connectionForm(); }

function diagnostics(): string {
  const row = (label: string, ready: boolean) => `<div class="direct-status-row"><span class="diagnostic-dot ${ready ? "pass" : "skip"}"></span><strong>${escape(label)}</strong><span>${escape(ready ? dt("ready") : dt("missing"))}</span></div>`;
  return `<section class="direct-card"><h2>${escape(dt("diagnosticsTitle"))}</h2>${row(dt("statusServer"), Boolean(currentUrl))}${row(dt("statusAuth"), Boolean(currentUser))}${row(dt("statusProject"), Boolean(selectedProject))}${row(dt("statusAsset"), Boolean(selectedAsset))}${row(dt("statusVersion"), Boolean(selectedVersion))}${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function render(): void {
  if (!root) return;
  root.innerHTML = `<div class="direct-freeframe-surface">${view === "review" ? review() : view === "media" ? media() : diagnostics()}</div>`;
}

function fail(): void { error = dt("requestFailed"); }

async function loadComments(): Promise<void> {
  comments = client && selectedAsset && selectedVersion ? await client.comments(selectedAsset, selectedVersion) : [];
}
async function loadVersions(): Promise<void> {
  versions = client && selectedAsset ? await client.versions(selectedAsset) : [];
  if (!versions.some(item => item.id === selectedVersion)) selectedVersion = versions[0]?.id ?? "";
  await loadComments();
}
async function loadAssets(): Promise<void> {
  assets = client && selectedProject ? await client.assets(selectedProject) : [];
  if (!assets.some(item => item.id === selectedAsset)) selectedAsset = "";
  await loadVersions();
}
async function loadProjects(): Promise<void> {
  if (!client) return;
  projects = await client.projects();
  if (!projects.some(item => item.id === selectedProject)) selectedProject = "";
  await loadAssets();
}
async function establish(nextClient: DirectFreeFrameClient, refreshToken: string): Promise<void> {
  client = nextClient;
  await store.saveRefreshToken(nextClient.root, refreshToken);
  currentUser = await nextClient.me();
  await loadProjects();
}
async function restore(): Promise<void> {
  if (restoring || currentUser || !currentUrl || mode !== "freeframe") return;
  restoring = true;
  try {
    const normalized = normalizeFreeFrameApiUrl(currentUrl);
    const refreshToken = await store.getRefreshToken(normalized);
    if (!refreshToken) return;
    const nextClient = new DirectFreeFrameClient(normalized);
    const renewed = await nextClient.refresh(refreshToken);
    await establish(nextClient, renewed.refresh_token);
  } catch { client = undefined; currentUser = undefined; }
  finally { restoring = false; render(); }
}

async function logout(): Promise<void> {
  if (currentUrl) await store.clearRefreshToken(currentUrl);
  client?.clearSession(); client = undefined; currentUser = undefined; projects = []; assets = []; versions = []; comments = []; selectedProject = ""; selectedAsset = ""; selectedVersion = ""; error = ""; render();
}

async function comment(): Promise<void> {
  const body = root?.querySelector<HTMLTextAreaElement>("#directComment")?.value.trim() ?? "";
  if (!client || !selectedAsset || !selectedVersion || !body) return;
  busy = true; error = ""; render();
  try {
    const context = await premiere.context();
    if (context.status !== "ready") throw new Error("No active Premiere sequence");
    const playhead = await premiere.playhead(context.sequence.projectGuid, context.sequence.id);
    await client.createComment(selectedAsset, selectedVersion, { body, timecode_start: playhead.seconds });
    await loadComments();
  } catch { fail(); }
  finally { busy = false; render(); }
}

root?.addEventListener("click", event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-action]")?.dataset.directAction;
  if (action === "settings") requestShellView("settings");
  if (action === "logout") void logout();
  if (action === "refresh") void (async () => { busy = true; error = ""; render(); try { await loadProjects(); } catch { fail(); } finally { busy = false; render(); } })();
  if (action === "comment") void comment();
  const commentId = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-resolve]")?.dataset.directResolve;
  if (commentId && client) void (async () => { try { await client!.toggleResolved(selectedAsset, selectedVersion, commentId); await loadComments(); } catch { fail(); } render(); })();
});
root?.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "directProject") { selectedProject = target.value; selectedAsset = ""; selectedVersion = ""; void (async () => { busy = true; render(); try { await loadAssets(); } catch { fail(); } finally { busy = false; render(); } })(); }
  if (target.id === "directAsset") { selectedAsset = target.value; selectedVersion = ""; void (async () => { busy = true; render(); try { await loadVersions(); } catch { fail(); } finally { busy = false; render(); } })(); }
  if (target.id === "directVersion") { selectedVersion = target.value; void (async () => { busy = true; render(); try { await loadComments(); } catch { fail(); } finally { busy = false; render(); } })(); }
});
window.addEventListener(SHELL_MODE_EVENT, event => { mode = normalizeShellMode((event as CustomEvent<unknown>).detail); if (mode === "freeframe") void restore(); });
window.addEventListener(SHELL_VIEW_EVENT, event => { view = normalizeShellView((event as CustomEvent<unknown>).detail); render(); });
window.addEventListener(INTERFACE_LOCALE_EVENT, render);
window.addEventListener(USER_CONFIG_EVENT, event => {
  if ((event as CustomEvent<unknown>).detail !== "freeframe") return;
  client?.clearSession(); client = undefined; currentUser = undefined; currentUrl = store.getUrl();
  projects = []; assets = []; versions = []; comments = []; selectedProject = ""; selectedAsset = ""; selectedVersion = "";
  void restore();
});

render();
void restore();
