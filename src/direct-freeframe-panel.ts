import type { ReviewComment } from "./domain";
import { DirectFreeFrameClient, directReviewVersion, type DirectAsset, type DirectProject, type DirectUser, type DirectVersion } from "./direct-freeframe-client";
import { dt } from "./direct-locale";
import { normalizeFreeFrameApiUrl } from "./freeframe-client";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { OperationGeneration } from "./operation-generation";
import { DirectFreeFrameStore } from "./persistence";
import { PremiereAdapter } from "./premiere";
import { createCommentAtPlayhead } from "./review-comments";
import { normalizeShellMode, normalizeShellView, requestShellView, SHELL_MODE_EVENT, SHELL_VIEW_EVENT, USER_CONFIG_EVENT, type ShellMode, type ShellView } from "./shell-events";

const root = document.querySelector<HTMLDivElement>("#direct-freeframe-app");
const store = new DirectFreeFrameStore();
const premiere = new PremiereAdapter();
const operations = new OperationGeneration();
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
let error = "";
let dialog: "" | "appearance" | "export" | "invite" = "";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const option = (value: string, label: string, selected: string) => `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;
const initials = (value: string) => value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "FF";

function createClient(url: string): DirectFreeFrameClient {
  return new DirectFreeFrameClient(url, {
    getRefreshToken: () => store.getRefreshToken(url),
    onTokens: tokens => store.saveRefreshToken(url, tokens.refresh_token),
    onSessionExpired: async () => { await store.clearRefreshToken(url); currentUser = undefined; },
  });
}

function connectionForm(): string {
  return `<section class="direct-card direct-empty"><div class="direct-empty-icon">FF</div><h2>${escape(dt("title"))}</h2><p>${escape(dt("loginRequired"))}</p><button class="compact" data-direct-action="settings">${escape(dt("openSettings"))}</button>${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function legacySelectors(): string {
  return `<section class="direct-card"><div class="direct-identity"><div><strong>${escape(currentUser?.name ?? "")}</strong><span>${escape(currentUser?.email ?? "")}</span></div><button class="secondary compact" data-direct-action="logout">${escape(dt("logout"))}</button></div><label for="directProject">${escape(dt("project"))}</label><select id="directProject"><option value="">${escape(dt("selectProject"))}</option>${projects.map(item => option(item.id, `${item.name} (${item.asset_count})`, selectedProject)).join("")}</select>${projects.length ? "" : `<p class="hint">${escape(dt("emptyProjects"))}</p>`}<label for="directAsset">${escape(dt("asset"))}</label><select id="directAsset"${selectedProject ? "" : " disabled"}><option value="">${escape(dt("selectAsset"))}</option>${assets.map(item => option(item.id, item.name, selectedAsset)).join("")}</select>${selectedProject && !assets.length ? `<p class="hint">${escape(dt("emptyAssets"))}</p>` : ""}<label for="directVersion">${escape(dt("version"))}</label><select id="directVersion"${selectedAsset ? "" : " disabled"}><option value="">${escape(dt("selectVersion"))}</option>${versions.map(item => option(item.id, `v${item.version_number} — ${item.processing_status}`, selectedVersion)).join("")}</select><button class="secondary" data-direct-action="refresh"${busy ? " disabled" : ""}>${escape(dt("refresh"))}</button>${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function selectors(): string {
  const project = projects.find(item => item.id === selectedProject);
  const asset = assets.find(item => item.id === selectedAsset);
  const version = versions.find(item => item.id === selectedVersion);
  const selected = [project?.name, asset?.name, version ? `v${version.version_number}` : undefined].filter((item): item is string => Boolean(item));
  const trail = selected.length
    ? selected.map(item => `<span>${escape(item)}</span>`).join(`<i aria-hidden="true">›</i>`)
    : `<span class="direct-context-empty">${escape(dt("selectProject"))}</span>`;
  return `<section class="direct-workspace"><div class="direct-workspace-head"><div class="direct-profile"><span class="direct-avatar" aria-hidden="true">${escape(initials(currentUser?.name ?? ""))}</span><div><strong>${escape(currentUser?.name ?? "")}</strong><span>${escape(currentUser?.email ?? "")}</span></div></div><div class="direct-workspace-actions"><button class="secondary compact" data-direct-action="refresh"${busy ? " disabled" : ""}>${escape(dt("refresh"))}</button><button class="secondary compact direct-signout" data-direct-action="logout">${escape(dt("logout"))}</button></div></div><div class="direct-context">${trail}</div><div class="direct-picker-grid"><div class="direct-picker"><label for="directProject">${escape(dt("project"))}</label><select id="directProject"><option value="">${escape(dt("selectProject"))}</option>${projects.map(item => option(item.id, `${item.name} (${item.asset_count})`, selectedProject)).join("")}</select>${projects.length ? "" : `<p class="hint">${escape(dt("emptyProjects"))}</p>`}</div><div class="direct-picker"><label for="directAsset">${escape(dt("asset"))}</label><select id="directAsset"${selectedProject ? "" : " disabled"}><option value="">${escape(dt("selectAsset"))}</option>${assets.map(item => option(item.id, item.name, selectedAsset)).join("")}</select>${selectedProject && !assets.length ? `<p class="hint">${escape(dt("emptyAssets"))}</p>` : ""}</div><div class="direct-picker"><label for="directVersion">${escape(dt("version"))}</label><select id="directVersion"${selectedAsset ? "" : " disabled"}><option value="">${escape(dt("selectVersion"))}</option>${versions.map(item => option(item.id, `v${item.version_number} · ${item.processing_status}`, selectedVersion)).join("")}</select></div></div>${error ? `<p class="error direct-workspace-error">${escape(error)}</p>` : ""}</section>`;
}

function legacyReview(): string {
  if (!currentUser) return connectionForm();
  const list = comments.length ? comments.map(comment => `<div class="comment-card${comment.resolved ? " resolved" : ""}"><div class="comment-meta"><span>${escape(comment.author?.name ?? comment.guest_author?.name ?? "FreeFrame")}${comment.timecode_start === null ? "" : ` · ${comment.timecode_start.toFixed(2)}s`}</span><button class="compact secondary" data-direct-resolve="${escape(comment.id)}">${escape(dt(comment.resolved ? "reopen" : "resolve"))}</button></div><p>${escape(comment.body)}</p></div>`).join("") : `<p class="hint">${escape(dt("noComments"))}</p>`;
  return `${selectors()}<section class="direct-card"><h2>${escape(dt("reviewTitle"))}</h2>${selectedVersion ? `<div class="comment-composer"><label for="directComment">${escape(dt("comment"))}</label><textarea id="directComment" placeholder="${escape(dt("commentPlaceholder"))}"></textarea><button data-direct-action="comment"${busy ? " disabled" : ""}>${escape(dt("addComment"))}</button></div><div class="comment-list">${list}</div>` : `<p>${escape(dt("selectVersion"))}</p>`}</section>`;
}

function previousReview(): string {
  if (!currentUser) return connectionForm();
  const version = versions.find(item => item.id === selectedVersion);
  const list = comments.length
    ? comments.map(comment => `<article class="comment-card${comment.resolved ? " resolved" : ""}"><div class="comment-meta"><div><strong>${escape(comment.author?.name ?? comment.guest_author?.name ?? "FreeFrame")}</strong><span>${comment.timecode_start === null ? "" : `${comment.timecode_start.toFixed(2)}s`}</span></div><button class="compact secondary" data-direct-resolve="${escape(comment.id)}">${escape(dt(comment.resolved ? "reopen" : "resolve"))}</button></div><p>${escape(comment.body)}</p></article>`).join("")
    : `<p class="hint">${escape(dt("noComments"))}</p>`;
  const detail = version ? `v${version.version_number} · ${version.processing_status}` : dt("selectVersion");
  const body = selectedVersion
    ? `<div class="comment-composer"><label for="directComment">${escape(dt("comment"))}</label><textarea id="directComment" placeholder="${escape(dt("commentPlaceholder"))}"></textarea><div class="direct-composer-actions"><span>${escape(dt("commentPlaceholder"))}</span><button data-direct-action="comment"${busy ? " disabled" : ""}>${escape(dt("addComment"))}</button></div></div><div class="comment-list direct-comment-list">${list}</div>`
    : `<div class="direct-review-empty"><div class="direct-empty-icon">+</div><p>${escape(dt("selectVersion"))}</p></div>`;
  return `${selectors()}<section class="direct-review-surface"><div class="direct-review-heading"><div><h2>${escape(dt("reviewTitle"))}</h2><p>${escape(detail)}</p></div><span class="direct-live-dot" aria-hidden="true"></span></div>${body}</section>`;
}

function previousMedia(): string { return currentUser ? selectors() : connectionForm(); }

function assetTiles(): string {
  if (!selectedProject) return `<div class="ff-empty-state"><div class="ff-empty-glyph">▦</div><p>${escape(dt("selectProjectToBrowse"))}</p></div>`;
  if (!assets.length) return `<div class="ff-empty-state"><div class="ff-empty-glyph">▦</div><p>${escape(dt("emptyAssets"))}</p></div>`;
  return `<div class="ff-asset-list">${assets.map(asset => `<button class="ff-asset-tile${asset.id === selectedAsset ? " selected" : ""}" data-direct-asset="${escape(asset.id)}"><span class="ff-asset-thumb">▶</span><span class="ff-asset-name">${escape(asset.name)}</span><span class="ff-asset-meta">${escape(asset.latest_version ? `v${asset.latest_version.version_number}` : dt("missing"))}</span></button>`).join("")}</div>`;
}

function sequencePage(): string {
  const currentAsset = assets.find(asset => asset.id === selectedAsset);
  const current = currentAsset
    ? `<button class="ff-current-card ff-current-linked" data-direct-asset="${escape(currentAsset.id)}"><span class="ff-asset-thumb">▶</span><span><strong>${escape(currentAsset.name)}</strong><small>${escape(currentAsset.latest_version ? `v${currentAsset.latest_version.version_number}` : dt("missing"))}</small></span></button>`
    : `<div class="ff-current-card"><span class="ff-empty-glyph">⇧</span><p>${escape(dt("sequenceNotExported"))}</p></div>`;
  const list = assets.length ? `<div class="ff-asset-list ff-sequence-list">${assets.map(asset => `<button class="ff-sequence-item${asset.id === selectedAsset ? " selected" : ""}" data-direct-asset="${escape(asset.id)}"><span class="ff-asset-thumb">▶</span><span><strong>${escape(asset.name)}</strong><small>${escape(asset.latest_version ? `v${asset.latest_version.version_number}` : dt("missing"))}</small></span></button>`).join("")}</div>` : `<div class="ff-empty-state"><div class="ff-empty-glyph">▦</div><p>${escape(dt("noLinkedSequenceAssets"))}</p></div>`;
  return `<div class="ff-page ff-sequences-page"><div class="ff-section-toolbar"><h2>${escape(dt("currentSequenceAsset"))}</h2><div><button class="secondary compact" data-direct-action="invite">${escape(dt("share"))}</button><button class="ff-plus" data-direct-action="export">+</button></div></div>${current}<div class="ff-section-toolbar ff-all-assets-title"><h2>${escape(dt("allSequenceAssets"))}</h2></div>${list}</div>`;
}

function browsePage(): string {
  const project = projects.find(item => item.id === selectedProject);
  const toolbar = `<div class="ff-browse-toolbar"><button class="ff-toolbar-button" data-direct-action="appearance">▦ ${escape(dt("appearance"))}</button><button class="ff-toolbar-button">☷ ${escape(dt("fields"))}</button><button class="ff-toolbar-button">≡ ${escape(dt("sortBy"))}: ${escape(dt("custom"))}</button><button class="secondary compact" data-direct-action="invite">${escape(dt("share"))}</button><button class="ff-plus" data-direct-action="export">+</button></div>`;
  return `<div class="ff-page ff-browse-page"><div class="ff-breadcrumb"><span>⌂</span><span>/</span><strong>${escape(project?.name ?? dt("title"))}</strong></div>${toolbar}<div class="ff-browse-selectors"><label for="directProject">${escape(dt("project"))}</label><select id="directProject"><option value="">${escape(dt("selectProject"))}</option>${projects.map(item => option(item.id, item.name, selectedProject)).join("")}</select>${selectedProject ? `<label for="directVersion">${escape(dt("version"))}</label><select id="directVersion"${selectedAsset ? "" : " disabled"}><option value="">${escape(dt("selectVersion"))}</option>${versions.map(item => option(item.id, `v${item.version_number} · ${item.processing_status}`, selectedVersion)).join("")}</select>` : ""}</div>${assetTiles()}</div>`;
}

function modal(): string {
  if (!dialog) return "";
  if (dialog === "appearance") return `<div class="ff-modal-backdrop"><section class="ff-popover"><div class="ff-popover-row"><strong>${escape(dt("layout"))}</strong><div class="ff-segmented"><button class="active">▦</button><button>☷</button></div></div><div class="ff-popover-row"><strong>${escape(dt("cardSize"))}</strong><div class="ff-segmented"><button>S</button><button class="active">M</button><button>L</button></div></div><div class="ff-popover-row"><strong>${escape(dt("thumbnailScale"))}</strong><button class="secondary compact">Fit⌄</button></div><div class="ff-popover-row"><strong>${escape(dt("showCardInfo"))}</strong><span class="ff-toggle active"></span></div><div class="ff-popover-row"><strong>${escape(dt("titles"))}</strong><button class="secondary compact">1 Line⌄</button></div><button class="ff-modal-close" data-direct-action="close-dialog">×</button></section></div>`;
  if (dialog === "invite") return `<div class="ff-modal-backdrop"><section class="ff-modal ff-invite-modal"><div class="ff-modal-title"><span class="ff-gradient-dot"></span><h2>${escape(dt("addToProject"))}</h2></div><div class="ff-invite-input"><input placeholder="${escape(dt("nameOrEmail"))}"/><select><option>${escape(dt("fullAccess"))}</option></select></div><p class="hint">${escape(dt("addToProject"))}</p><div class="ff-invite-space"></div><textarea placeholder="${escape(dt("addMessage"))}"></textarea><div class="ff-modal-actions"><button class="secondary" data-direct-action="close-dialog">${escape(dt("cancel"))}</button><button disabled>${escape(dt("add"))}</button></div></section></div>`;
  return `<div class="ff-modal-backdrop"><section class="ff-modal"><div class="ff-modal-title"><h2>${escape(dt("exportTitle"))}</h2><button class="ff-modal-close" data-direct-action="close-dialog">×</button></div><div class="ff-form-row"><label>${escape(dt("exportName"))}</label><input value="${escape(assets.find(item => item.id === selectedAsset)?.name ?? "")}"/></div><div class="ff-form-row"><label>${escape(dt("uploadLocation"))}</label><select><option>${escape(dt("selectProject"))}</option></select></div><div class="ff-form-row"><label>${escape(dt("range"))}</label><select><option>${escape(dt("entireSequence"))}</option></select></div><div class="ff-form-row"><label>${escape(dt("preset"))}</label><select><option>Match Source</option></select></div><div class="ff-form-row"><label>${escape(dt("markersAsComments"))}</label><span class="ff-toggle"></span></div><div class="ff-form-row"><label>${escape(dt("saveLocalCopy"))}</label><span class="ff-toggle"></span></div><p class="hint">${escape(dt("exportUnavailable"))}</p><div class="ff-modal-actions"><button class="secondary" data-direct-action="close-dialog">${escape(dt("cancel"))}</button><button disabled>${escape(dt("exportSequence"))}</button></div></section></div>`;
}

function review(): string { return currentUser ? sequencePage() : connectionForm(); }
function media(): string { return currentUser ? browsePage() : connectionForm(); }

function diagnostics(): string {
  const row = (label: string, ready: boolean) => `<div class="direct-status-row"><span class="diagnostic-dot ${ready ? "pass" : "skip"}"></span><strong>${escape(label)}</strong><span>${escape(ready ? dt("ready") : dt("missing"))}</span></div>`;
  return `<section class="direct-card"><h2>${escape(dt("diagnosticsTitle"))}</h2>${row(dt("statusServer"), Boolean(currentUrl))}${row(dt("statusAuth"), Boolean(currentUser))}${row(dt("statusProject"), Boolean(selectedProject))}${row(dt("statusAsset"), Boolean(selectedAsset))}${row(dt("statusVersion"), Boolean(selectedVersion))}${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function render(): void {
  if (!root) return;
  root.innerHTML = `<div class="direct-freeframe-surface">${view === "review" ? review() : view === "media" ? media() : diagnostics()}${modal()}</div>`;
}

function fail(): void { error = dt("requestFailed"); }

async function loadComments(generation: number): Promise<void> {
  const next = client && selectedAsset && selectedVersion ? await client.comments(selectedAsset, selectedVersion) : [];
  operations.assertCurrent(generation); comments = next;
}
async function loadVersions(generation: number): Promise<void> {
  const next = client && selectedAsset ? await client.versions(selectedAsset) : [];
  operations.assertCurrent(generation); versions = next;
  if (!versions.some(item => item.id === selectedVersion)) selectedVersion = versions[0]?.id ?? "";
  await loadComments(generation);
}
async function loadAssets(generation: number): Promise<void> {
  const next = client && selectedProject ? await client.assets(selectedProject) : [];
  operations.assertCurrent(generation); assets = next;
  if (!assets.some(item => item.id === selectedAsset)) selectedAsset = "";
  await loadVersions(generation);
}
async function loadProjects(generation: number): Promise<void> {
  if (!client) return;
  const next = await client.projects();
  operations.assertCurrent(generation); projects = next;
  if (!projects.some(item => item.id === selectedProject)) selectedProject = "";
  await loadAssets(generation);
}
async function establish(nextClient: DirectFreeFrameClient, refreshToken: string, generation: number): Promise<void> {
  operations.assertCurrent(generation);
  client = nextClient;
  await store.saveRefreshToken(nextClient.root, refreshToken);
  operations.assertCurrent(generation);
  const user = await nextClient.me();
  operations.assertCurrent(generation); currentUser = user;
  await loadProjects(generation);
}
async function restore(): Promise<void> {
  if (currentUser || !currentUrl || mode !== "freeframe") return;
  const generation = operations.begin();
  try {
    const normalized = normalizeFreeFrameApiUrl(currentUrl);
    const refreshToken = await store.getRefreshToken(normalized);
    operations.assertCurrent(generation);
    if (!refreshToken) return;
    const nextClient = createClient(normalized);
    const renewed = await nextClient.refresh(refreshToken);
    operations.assertCurrent(generation);
    await establish(nextClient, renewed.refresh_token, generation);
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { client = undefined; currentUser = undefined; } }
  finally { if (operations.current(generation)) render(); }
}

async function logout(): Promise<void> {
  operations.begin();
  if (currentUrl) await store.clearRefreshToken(currentUrl);
  client?.clearSession(); client = undefined; currentUser = undefined; projects = []; assets = []; versions = []; comments = []; selectedProject = ""; selectedAsset = ""; selectedVersion = ""; error = ""; render();
}

async function comment(): Promise<void> {
  const body = root?.querySelector<HTMLTextAreaElement>("#directComment")?.value.trim() ?? "";
  if (!client || !selectedAsset || !selectedVersion || !body) return;
  const generation = operations.begin(); busy = true; error = ""; render();
  try {
    const context = await premiere.context();
    operations.assertCurrent(generation);
    if (context.status !== "ready") throw new Error("No active Premiere sequence");
    const playhead = await premiere.playhead(context.sequence.projectGuid, context.sequence.id);
    operations.assertCurrent(generation);
    const version = versions.find(item => item.id === selectedVersion);
    if (!version) throw new Error("No selected FreeFrame version");
    await createCommentAtPlayhead(client, selectedAsset, directReviewVersion(version), body, playhead.seconds, playhead.sequenceDurationSeconds ?? context.sequence.durationSeconds);
    operations.assertCurrent(generation); await loadComments(generation);
  } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); }
  finally { if (operations.current(generation)) { busy = false; render(); } }
}

root?.addEventListener("click", event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-action]")?.dataset.directAction;
  if (action === "settings") requestShellView("settings");
  if (action === "logout") void logout();
  if (action === "refresh") void (async () => { const generation = operations.begin(); busy = true; error = ""; render(); try { await loadProjects(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })();
  if (action === "comment") void comment();
  if (action === "appearance" || action === "export" || action === "invite") { dialog = action === "appearance" ? "appearance" : action === "export" ? "export" : "invite"; render(); }
  if (action === "close-dialog") { dialog = ""; render(); }
  const assetId = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-asset]")?.dataset.directAsset;
  if (assetId && assetId !== selectedAsset) {
    const generation = operations.begin(); selectedAsset = assetId; selectedVersion = "";
    void (async () => { busy = true; render(); try { await loadVersions(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })();
  }
  const commentId = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-resolve]")?.dataset.directResolve;
  if (commentId && client) void (async () => { const generation = operations.begin(); try { await client!.toggleResolved(selectedAsset, selectedVersion, commentId); operations.assertCurrent(generation); await loadComments(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } if (operations.current(generation)) render(); })();
});
root?.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "directProject") { const generation = operations.begin(); selectedProject = target.value; selectedAsset = ""; selectedVersion = ""; void (async () => { busy = true; render(); try { await loadAssets(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })(); }
  if (target.id === "directAsset") { const generation = operations.begin(); selectedAsset = target.value; selectedVersion = ""; void (async () => { busy = true; render(); try { await loadVersions(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })(); }
  if (target.id === "directVersion") { const generation = operations.begin(); selectedVersion = target.value; void (async () => { busy = true; render(); try { await loadComments(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })(); }
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
