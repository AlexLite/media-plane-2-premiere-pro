import type { ReviewComment, SequenceInfo } from "./domain";
import { ACTIVE_CONTEXT_EVENT } from "./active-context";
import { DirectFreeFrameClient, directApiUrl, directReviewVersion, type DirectAsset, type DirectProject, type DirectUser, type DirectVersion } from "./direct-freeframe-client";
import { dt } from "./direct-locale";
import { FreeFrameError, normalizeFreeFrameApiUrl } from "./freeframe-client";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { OperationGeneration } from "./operation-generation";
import { DirectFreeFrameStore } from "./persistence";
import { PremiereAdapter } from "./premiere";
import { createCommentAtPlayhead } from "./review-comments";
import { FREEFRAME_AUTH_EVENT, normalizeShellMode, normalizeShellView, requestShellView, SHELL_MODE_EVENT, SHELL_VIEW_EVENT, USER_CONFIG_EVENT, type ShellMode, type ShellView } from "./shell-events";
import { UxpMediaFiles, type SelectedMediaFile } from "./uxp-media";

declare const require: (name: string) => { shell?: { openExternal?(url: string, developerText?: string): Promise<string> } };

const root = document.querySelector<HTMLDivElement>("#direct-freeframe-app");
const store = new DirectFreeFrameStore();
const premiere = new PremiereAdapter();
const mediaFiles = new UxpMediaFiles();
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
let activeSequence: SequenceInfo | undefined;
let activeSequenceAsset: DirectAsset | undefined;
const assetCache = new Map<string, DirectAsset>();
let activeSequenceRequest = 0;
let exportFile: SelectedMediaFile | undefined;
let exportProject = "";
let exportProgress: number | undefined;
let busy = false;
let error = "";
let dialog: "" | "appearance" | "export" | "invite" = "";
let browserLogin: { client: DirectFreeFrameClient; deviceCode: string; intervalMs: number; expiresAt: number; userCode: string } | undefined;
let browserLoginTimer: number | undefined;
let publishedAuthentication: boolean | undefined;

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const option = (value: string, label: string, selected: string) => `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;
const initials = (value: string) => value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "FF";

function createClient(url: string): DirectFreeFrameClient {
  return new DirectFreeFrameClient(directApiUrl(url), {
    getRefreshToken: () => store.getRefreshToken(url),
    onTokens: tokens => store.saveRefreshToken(url, tokens.refresh_token),
    onSessionExpired: async () => { await store.clearRefreshToken(url); currentUser = undefined; },
  }, url);
}

function connectionForm(): string {
  const waiting = browserLogin
    ? `<div class="ff-browser-waiting"><strong>${escape(dt("browserWaiting"))}</strong><p>${escape(dt("browserCode"))}: <b>${escape(browserLogin.userCode)}</b></p><div class="ff-action-secondary" role="button" tabindex="0" data-direct-action="browser-cancel">${escape(dt("browserCancel"))}</div></div>`
    : `<label class="ff-server-input" for="directServerUrl">${escape(dt("serverAddress"))}<input id="directServerUrl" value="${escape(currentUrl)}" placeholder="https://freeframe.example.com" autocomplete="off"></label><p class="ff-browser-hint">${escape(dt("browserSignInHint"))}</p><div class="ff-action-primary" role="button" tabindex="0" data-direct-action="browser-login">${escape(dt("browserSignIn"))}</div>`;
  return `<section class="ff-onboarding"><div class="ff-onboarding-content"><div class="ff-onboarding-mark" aria-hidden="true"><i></i><i></i><i></i></div><h2>${escape(dt("title"))}</h2><p>${escape(dt("loginRequired"))}</p>${waiting}${error ? `<p class="error">${escape(error)}</p>` : ""}</div></section>`;
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
  const current = activeSequenceAsset
    ? `<button class="ff-current-card ff-current-linked" data-direct-asset="${escape(activeSequenceAsset.id)}"><span class="ff-asset-thumb">▶</span><span><strong>${escape(activeSequenceAsset.name)}</strong><small>${escape(activeSequenceAsset.latest_version ? `v${activeSequenceAsset.latest_version.version_number}` : dt("missing"))}</small></span></button>`
    : `<div class="ff-current-card"><span class="ff-empty-glyph">⇧</span><p>${escape(activeSequence ? dt("sequenceNotExported") : dt("noLinkedSequenceAssets"))}</p></div>`;
  const list = assets.length ? `<div class="ff-asset-list ff-sequence-list">${assets.map(asset => `<button class="ff-sequence-item${asset.id === activeSequenceAsset?.id ? " selected" : ""}" data-direct-asset="${escape(asset.id)}"><span class="ff-asset-thumb">▶</span><span><strong>${escape(asset.name)}</strong><small>${escape(asset.latest_version ? `v${asset.latest_version.version_number}` : dt("missing"))}</small></span></button>`).join("")}</div>` : `<div class="ff-empty-state"><div class="ff-empty-glyph">▦</div><p>${escape(dt("noLinkedSequenceAssets"))}</p></div>`;
  return `<div class="ff-page ff-sequences-page"><div class="ff-section-toolbar"><h2>${escape(dt("currentSequenceAsset"))}</h2><div class="ff-section-actions"><div class="ff-toolbar-control ff-share-control" role="button" tabindex="0" data-direct-action="invite">${escape(dt("share"))}</div><div class="ff-toolbar-add" role="button" tabindex="0" data-direct-action="export">+</div></div></div>${current}<div class="ff-section-toolbar ff-all-assets-title"><h2>${escape(dt("allSequenceAssets"))}</h2></div>${list}</div>`;
}

function browsePage(): string {
  const project = projects.find(item => item.id === selectedProject);
  const toolbar = `<div class="ff-browse-toolbar"><div class="ff-toolbar-control" role="button" tabindex="0" data-direct-action="appearance">▦ ${escape(dt("appearance"))}</div><div class="ff-toolbar-control" role="button" tabindex="0">☷ ${escape(dt("fields"))}</div><div class="ff-toolbar-control" role="button" tabindex="0">≡ ${escape(dt("sortBy"))}: ${escape(dt("custom"))}</div><span class="ff-toolbar-spacer"></span><div class="ff-toolbar-control" role="button" tabindex="0" data-direct-action="invite">${escape(dt("share"))}</div><div class="ff-toolbar-add" role="button" tabindex="0" data-direct-action="export">+</div></div>`;
  const breadcrumb = selectedProject
    ? `<span class="ff-breadcrumb-link" role="button" tabindex="0" data-direct-project="">⌂</span><span>/</span><strong>${escape(project?.name ?? dt("title"))}</strong>`
    : `<span>⌂</span><span>/</span><strong>${escape(dt("title"))}</strong>`;
  const projectsView = projects.length
    ? `<div class="ff-project-grid">${projects.map(item => `<div class="ff-project-card" role="button" tabindex="0" data-direct-project="${escape(item.id)}"><span class="ff-project-mark">▦</span><strong>${escape(item.name)}</strong><small>${escape(item.description ?? `${item.asset_count} ${dt("assets")}`)}</small></div>`).join("")}</div>`
    : `<div class="ff-empty-state"><div class="ff-empty-glyph">▦</div><p>${escape(dt("emptyProjects"))}</p></div>`;
  return `<div class="ff-page ff-browse-page"><div class="ff-breadcrumb">${breadcrumb}</div>${toolbar}${selectedProject ? assetTiles() : projectsView}</div>`;
}

function modal(): string {
  if (!dialog) return "";
  if (dialog === "appearance") return `<div class="ff-modal-backdrop"><section class="ff-popover"><div class="ff-popover-row"><strong>${escape(dt("layout"))}</strong><div class="ff-segmented"><button class="active">▦</button><button>☷</button></div></div><div class="ff-popover-row"><strong>${escape(dt("cardSize"))}</strong><div class="ff-segmented"><button>S</button><button class="active">M</button><button>L</button></div></div><div class="ff-popover-row"><strong>${escape(dt("thumbnailScale"))}</strong><button class="secondary compact">Fit⌄</button></div><div class="ff-popover-row"><strong>${escape(dt("showCardInfo"))}</strong><span class="ff-toggle active"></span></div><div class="ff-popover-row"><strong>${escape(dt("titles"))}</strong><button class="secondary compact">1 Line⌄</button></div><button class="ff-modal-close" data-direct-action="close-dialog">×</button></section></div>`;
  if (dialog === "invite") return `<div class="ff-modal-backdrop"><section class="ff-modal ff-invite-modal"><div class="ff-modal-title"><span class="ff-gradient-dot"></span><h2>${escape(dt("addToProject"))}</h2></div><div class="ff-invite-input"><input placeholder="${escape(dt("nameOrEmail"))}"/><select><option>${escape(dt("fullAccess"))}</option></select></div><p class="hint">${escape(dt("addToProject"))}</p><div class="ff-invite-space"></div><textarea placeholder="${escape(dt("addMessage"))}"></textarea><div class="ff-modal-actions"><button class="secondary" data-direct-action="close-dialog">${escape(dt("cancel"))}</button><button disabled>${escape(dt("add"))}</button></div></section></div>`;
  const existing = activeSequenceAsset;
  const projectId = existing?.project_id ?? exportProject;
  const canExport = Boolean(activeSequence && exportFile && projectId && !busy);
  const fileLabel = exportFile ? `${exportFile.name} (${Math.ceil(exportFile.size / 1024 / 1024)} MB)` : dt("selectAsset");
  const progress = exportProgress === undefined ? "" : `<p class="hint">${Math.round(exportProgress * 100)}%</p>`;
  return `<div class="ff-modal-backdrop"><section class="ff-modal"><div class="ff-modal-title"><h2>${escape(dt("exportTitle"))}</h2><button class="ff-modal-close" data-direct-action="close-dialog">×</button></div><div class="ff-form-row"><label for="directExportName">${escape(dt("exportName"))}</label><input id="directExportName" value="${escape(existing?.name ?? activeSequence?.name ?? "")}"/></div><div class="ff-form-row"><label for="directExportProject">${escape(dt("uploadLocation"))}</label><select id="directExportProject"${existing ? " disabled" : ""}><option value="">${escape(dt("selectProject"))}</option>${projects.map(project => option(project.id, project.name, projectId)).join("")}</select></div><div class="ff-form-row"><label>${escape(dt("asset"))}</label><button class="secondary" data-direct-action="select-export-file"${busy ? " disabled" : ""}>${escape(fileLabel)}</button></div><div class="ff-form-row"><label>${escape(dt("range"))}</label><span>${escape(dt("entireSequence"))}</span></div>${existing ? `<p class="hint">${escape(`v${existing.latest_version?.version_number ?? 0} → new version`)}</p>` : ""}${progress}${error ? `<p class="error">${escape(error)}</p>` : ""}<div class="ff-modal-actions"><button class="secondary" data-direct-action="close-dialog"${busy ? " disabled" : ""}>${escape(dt("cancel"))}</button><button data-direct-action="export-confirm"${canExport ? "" : " disabled"}>${escape(dt("exportSequence"))}</button></div></section></div>`;
}

function review(): string { return currentUser ? sequencePage() : connectionForm(); }
function media(): string { return currentUser ? browsePage() : connectionForm(); }

function diagnostics(): string {
  const row = (label: string, ready: boolean) => `<div class="direct-status-row"><span class="diagnostic-dot ${ready ? "pass" : "skip"}"></span><strong>${escape(label)}</strong><span>${escape(ready ? dt("ready") : dt("missing"))}</span></div>`;
  return `<section class="direct-card"><h2>${escape(dt("diagnosticsTitle"))}</h2>${row(dt("statusServer"), Boolean(currentUrl))}${row(dt("statusAuth"), Boolean(currentUser))}${row(dt("statusProject"), Boolean(selectedProject))}${row(dt("statusAsset"), Boolean(selectedAsset))}${row(dt("statusVersion"), Boolean(selectedVersion))}${error ? `<p class="error">${escape(error)}</p>` : ""}</section>`;
}

function render(): void {
  const authenticated = Boolean(currentUser);
  if (authenticated !== publishedAuthentication) { publishedAuthentication = authenticated; window.dispatchEvent(new CustomEvent(FREEFRAME_AUTH_EVENT, { detail: authenticated })); }
  if (!root) return;
  root.innerHTML = `<div class="direct-freeframe-surface">${view === "review" ? review() : view === "media" ? media() : diagnostics()}${modal()}</div>`;
}

function fail(caught?: unknown): void {
  const detail = caught instanceof FreeFrameError ? `HTTP ${caught.status}` : caught instanceof Error ? caught.message : "";
  error = detail ? `${dt("requestFailed")} (${detail.slice(0, 160)})` : dt("requestFailed");
  if (caught) console.error("FreeFrame request failed", caught);
}

function clearBrowserLogin(): void {
  if (browserLoginTimer !== undefined) window.clearTimeout(browserLoginTimer);
  browserLoginTimer = undefined;
  browserLogin = undefined;
}
async function pollBrowserLogin(expected: NonNullable<typeof browserLogin>, generation: number): Promise<void> {
  if (browserLogin !== expected || !operations.current(generation)) return;
  if (Date.now() >= expected.expiresAt) { clearBrowserLogin(); error = dt("requestFailed"); render(); return; }
  try {
    const tokens = await expected.client.pollDeviceAuthorization(expected.deviceCode);
    operations.assertCurrent(generation);
    if (!tokens) { browserLoginTimer = window.setTimeout(() => void pollBrowserLogin(expected, generation), expected.intervalMs); return; }
    clearBrowserLogin();
    await establish(expected.client, tokens.refresh_token, generation);
    error = "";
  } catch (caught) {
    if (!(caught instanceof DOMException && caught.name === "AbortError")) { clearBrowserLogin(); fail(caught); }
  }
  if (operations.current(generation)) render();
}
async function startBrowserLogin(): Promise<void> {
  const url = root?.querySelector<HTMLInputElement>("#directServerUrl")?.value.trim() ?? currentUrl;
  const generation = operations.begin(); error = "";
  try {
    const normalized = normalizeFreeFrameApiUrl(url);
    currentUrl = normalized;
    store.saveUrl(currentUrl);
    const next = createClient(normalized);
    const authorization = await next.startDeviceAuthorization();
    operations.assertCurrent(generation);
    browserLogin = { client: next, deviceCode: authorization.device_code, userCode: authorization.user_code, intervalMs: authorization.interval * 1000, expiresAt: Date.now() + authorization.expires_in * 1000 };
    const browserUrl = authorization.verification_uri_complete ?? authorization.verification_uri;
    if (!require("uxp").shell?.openExternal) throw new Error("UXP browser launch is unavailable");
    const launchResult = await require("uxp").shell!.openExternal!(browserUrl, "Open FreeFrame in your browser to confirm Premiere access.");
    if (launchResult) throw new Error(launchResult);
    operations.assertCurrent(generation);
    void pollBrowserLogin(browserLogin, generation);
  } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(caught); }
  if (operations.current(generation)) render();
}

function cacheAssets(next: DirectAsset[]): void {
  for (const asset of next) assetCache.set(asset.id, asset);
}

function sameSequenceName(asset: DirectAsset, sequence: SequenceInfo): boolean {
  return asset.name.trim().localeCompare(sequence.name.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/**
 * Frame.io's Current Sequence section follows Premiere's active sequence, not
 * the last asset selected in Browse.  FreeFrame will eventually receive this
 * relation from the export endpoint; exact-name discovery only restores links
 * for assets uploaded before that endpoint existed.
 */
async function refreshActiveSequence(): Promise<void> {
  const request = ++activeSequenceRequest;
  const current = await premiere.context();
  if (request !== activeSequenceRequest) return;
  if (current.status !== "ready" || !client || !currentUrl || !currentUser) {
    activeSequence = undefined;
    activeSequenceAsset = undefined;
    render();
    return;
  }

  const sequence = current.sequence;
  let binding = store.getSequenceBinding(currentUrl, sequence.projectGuid, sequence.id);
  let linked = binding ? assetCache.get(binding.assetId) : undefined;
  if (binding && !linked) {
    const next = await client.assets(binding.projectId);
    if (request !== activeSequenceRequest) return;
    cacheAssets(next);
    linked = next.find(asset => asset.id === binding!.assetId);
  }
  if (!binding) {
    for (const project of projects) {
      const next = await client.assets(project.id);
      if (request !== activeSequenceRequest) return;
      cacheAssets(next);
      const candidate = next.find(asset => sameSequenceName(asset, sequence));
      if (!candidate) continue;
      binding = { serverUrl: currentUrl, projectGuid: sequence.projectGuid, sequenceId: sequence.id, projectId: project.id, assetId: candidate.id };
      store.saveSequenceBinding(binding);
      linked = candidate;
      break;
    }
  }
  if (request !== activeSequenceRequest) return;
  activeSequence = sequence;
  activeSequenceAsset = linked;
  render();
}

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
  operations.assertCurrent(generation); assets = next; cacheAssets(next);
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
  if (operations.current(generation)) void refreshActiveSequence();
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
  clearBrowserLogin();
  if (currentUrl) await store.clearRefreshToken(currentUrl);
  client?.clearSession(); client = undefined; currentUser = undefined; projects = []; assets = []; assetCache.clear(); versions = []; comments = []; selectedProject = ""; selectedAsset = ""; selectedVersion = ""; activeSequence = undefined; activeSequenceAsset = undefined; activeSequenceRequest++; error = ""; render();
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

async function selectExportFile(): Promise<void> {
  if (busy) return;
  try { exportFile = await mediaFiles.selectExported(); error = ""; }
  catch (caught) { fail(caught); }
  render();
}

async function exportCurrentSequence(): Promise<void> {
  if (!client || !exportFile || busy) return;
  const context = await premiere.context();
  if (context.status !== "ready") { error = dt("sequenceNotExported"); render(); return; }
  const existing = store.getSequenceBinding(currentUrl, context.sequence.projectGuid, context.sequence.id);
  const projectId = existing?.projectId ?? exportProject;
  const name = root?.querySelector<HTMLInputElement>("#directExportName")?.value.trim() ?? context.sequence.name;
  if (!projectId || !name) return;
  const generation = operations.begin();
  busy = true; error = ""; exportProgress = 0; render();
  try {
    const result = await client.upload(projectId, name, exportFile, existing?.assetId, progress => {
      if (operations.current(generation)) { exportProgress = progress; render(); }
    });
    operations.assertCurrent(generation);
    store.saveSequenceBinding({ serverUrl: currentUrl, projectGuid: context.sequence.projectGuid, sequenceId: context.sequence.id, projectId, assetId: result.assetId });
    const nextAssets = await client.assets(projectId);
    operations.assertCurrent(generation);
    cacheAssets(nextAssets);
    activeSequence = context.sequence;
    activeSequenceAsset = nextAssets.find(asset => asset.id === result.assetId);
    selectedProject = projectId;
    assets = nextAssets;
    selectedAsset = result.assetId;
    versions = await client.versions(result.assetId);
    operations.assertCurrent(generation);
    selectedVersion = result.versionId;
    comments = [];
    dialog = "";
    exportFile = undefined;
    exportProgress = undefined;
  } catch (caught) {
    if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(caught);
  } finally {
    if (operations.current(generation)) { busy = false; exportProgress = undefined; render(); }
  }
}

root?.addEventListener("click", event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-action]")?.dataset.directAction;
  if (action === "settings") requestShellView("settings");
  if (action === "logout") void logout();
  if (action === "browser-login") void startBrowserLogin();
  if (action === "browser-cancel") { operations.begin(); clearBrowserLogin(); error = ""; render(); }
  if (action === "refresh") void (async () => { const generation = operations.begin(); busy = true; error = ""; render(); try { await loadProjects(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(); } finally { if (operations.current(generation)) { busy = false; render(); } } })();
  if (action === "comment") void comment();
  if (action === "select-export-file") void selectExportFile();
  if (action === "export-confirm") void exportCurrentSequence();
  if (action === "appearance" || action === "export" || action === "invite") {
    dialog = action === "appearance" ? "appearance" : action === "export" ? "export" : "invite";
    if (action === "export") { exportFile = undefined; exportProgress = undefined; exportProject = activeSequenceAsset?.project_id ?? selectedProject; }
    render();
  }
  if (action === "close-dialog") { dialog = ""; exportFile = undefined; exportProgress = undefined; render(); }
  const projectTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-direct-project]");
  if (projectTarget) {
    const projectId = projectTarget.dataset.directProject ?? "";
    if (projectId !== selectedProject) {
      const generation = operations.begin(); selectedProject = projectId; selectedAsset = ""; selectedVersion = ""; assets = []; versions = []; comments = [];
      if (!projectId) { render(); return; }
      void (async () => { busy = true; render(); try { await loadAssets(generation); } catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) fail(caught); } finally { if (operations.current(generation)) { busy = false; render(); } } })();
    }
    return;
  }
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
  if (target.id === "directExportProject") { exportProject = target.value; render(); }
});
window.addEventListener(SHELL_MODE_EVENT, event => { mode = normalizeShellMode((event as CustomEvent<unknown>).detail); if (mode === "freeframe") void restore(); });
window.addEventListener(SHELL_VIEW_EVENT, event => { view = normalizeShellView((event as CustomEvent<unknown>).detail); render(); });
window.addEventListener(ACTIVE_CONTEXT_EVENT, () => { if (mode === "freeframe" && currentUser) void refreshActiveSequence(); });
window.addEventListener(INTERFACE_LOCALE_EVENT, render);
window.addEventListener(USER_CONFIG_EVENT, event => {
  if ((event as CustomEvent<unknown>).detail !== "freeframe") return;
  clearBrowserLogin(); client?.clearSession(); client = undefined; currentUser = undefined; currentUrl = store.getUrl();
  projects = []; assets = []; assetCache.clear(); versions = []; comments = []; selectedProject = ""; selectedAsset = ""; selectedVersion = ""; activeSequence = undefined; activeSequenceAsset = undefined; activeSequenceRequest++;
  void restore();
});

render();
void restore();
