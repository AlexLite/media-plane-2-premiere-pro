import {
  compatibleVideoAssets,
  createVideoAssetAndLink,
  linkAssetAndConfirm,
  loadAssetReview,
  type AssetReviewState,
  unlinkAssetAndConfirm,
} from "./asset-workflow";
import { ACTIVE_CONTEXT_EVENT } from "./active-context";
import type { PlaneUser, PremiereContext, ProjectSummary, ReviewAsset, SequenceBinding, SequenceInfo, WorkspaceSummary, WorkItem } from "./domain";
import { type MessageKey, t } from "./locale";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { OperationGeneration } from "./operation-generation";
import { BindingStore } from "./persistence";
import { PlaneClient, PlaneError } from "./plane-client";
import { ProcessingContinuesError } from "./processing-poller";
import { PremiereAdapter } from "./premiere";
import { PremiereDirectExporter, type PreparedDirectExport } from "./premiere-export";
import { ReviewSessionManager } from "./review-session";
import { ReviewUploadController, type TransferSnapshot } from "./upload-controller";
import { UxpMediaFiles, type SelectedMediaFile } from "./uxp-media";
import { requestShellView, USER_CONFIG_EVENT } from "./shell-events";

const root = document.querySelector<HTMLDivElement>("#app")!;
const store = new BindingStore();
const premiere = new PremiereAdapter();
const directExporter = new PremiereDirectExporter();
const mediaFiles = new UxpMediaFiles();
const contextOperations = new OperationGeneration();

interface ConnectionDraft {
  baseUrl: string;
  token: string;
  client?: PlaneClient;
  user?: PlaneUser;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  workItems: WorkItem[];
  workspaceSlug: string;
  projectId: string;
  workItemId: string;
}
interface BoundState {
  binding: SequenceBinding;
  user: PlaneUser;
  workItem: WorkItem;
  client: PlaneClient;
  sessions: ReviewSessionManager;
  review?: AssetReviewState;
}
interface AssetDraft {
  query: string;
  assets: ReviewAsset[];
  selectedAssetId: string;
  newAssetName: string;
  searched: boolean;
  confirmUnlink: boolean;
}

let context: PremiereContext = { status: "no-project" };
let sequence: SequenceInfo | undefined;
let bound: BoundState | undefined;
let draft: ConnectionDraft = emptyDraft();
let assetDraft: AssetDraft = emptyAssetDraft();
let errorKey: MessageKey | undefined;
let noticeKey: MessageKey | undefined;
let busyKey: MessageKey | undefined;
let selectedMedia: SelectedMediaFile | undefined;
let preparedExport: PreparedDirectExport | undefined;
let transfer: TransferSnapshot = { stage: "idle", progress: 0 };
let transferController: ReviewUploadController | undefined;

function emptyDraft(binding?: SequenceBinding): ConnectionDraft {
  return {
    baseUrl: binding?.baseUrl ?? store.getPlaneUrl(),
    token: "",
    workspaces: [],
    projects: [],
    workItems: [],
    workspaceSlug: binding?.workspaceSlug ?? "",
    projectId: binding?.projectId ?? "",
    workItemId: binding?.workItemId ?? "",
  };
}
function emptyAssetDraft(): AssetDraft {
  return { query: "", assets: [], selectedAssetId: "", newAssetName: sequence?.name ?? "", searched: false, confirmUnlink: false };
}
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const value = (id: string): string => (root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? "").trim();
const selected = (actual: string, expected: string): string => actual === expected ? " selected" : "";
const disabled = (condition: boolean): string => condition ? " disabled" : "";


function resetTransferState(): void {
  transferController?.cancel();
  transferController = undefined;
  selectedMedia = undefined;
  preparedExport = undefined;
  transfer = { stage: "idle", progress: 0 };
}
function transferRunning(): boolean { return ["exporting", "uploading", "processing"].includes(transfer.stage); }
function transferStageKey(): MessageKey {
  return ({ idle: "transferIdle", exporting: "transferExporting", uploading: "transferUploading", processing: "transferProcessing", "processing-background": "transferProcessingBackground", ready: "transferReady", failed: "transferFailed", cancelled: "transferCancelled" } as const)[transfer.stage];
}
function fileSize(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function shell(content: string): string {
  return `<header><h1>${escape(t("title"))}</h1><p>${escape(t("architecture"))}</p></header><main>${content}</main>`;
}
function feedback(): string {
  const busy = busyKey ? `<p class="status">${escape(t(busyKey))}</p>` : "";
  const error = errorKey ? `<p class="error">${escape(t(errorKey))}</p>` : "";
  const notice = noticeKey ? `<p class="notice">${escape(t(noticeKey))}</p>` : "";
  return `${busy}${error}${notice}`;
}
function optionList<T>(items: T[], current: string, label: (item: T) => string, id: (item: T) => string, placeholder: MessageKey): string {
  return `<option value="">${escape(t(placeholder))}</option>${items.map(item => `<option value="${escape(id(item))}"${selected(current, id(item))}>${escape(label(item))}</option>`).join("")}`;
}
function renderHostMessage(key: MessageKey): void {
  root.innerHTML = shell(`<section><h2>${escape(t("sequence"))}</h2><p class="warning">${escape(t(key))}</p></section>${feedback()}`);
}
function renderConnection(): void {
  if (!sequence) return;
  const isBusy = Boolean(busyKey);
  const user = draft.user ? `<section class="identity"><h2>${escape(t("connectedAs"))}</h2><p><strong>${escape(draft.user.displayName)}</strong><br>${escape(draft.user.email)}</p></section>` : "";
  const workspaceEmpty = draft.user && draft.workspaces.length === 0 ? `<p class="warning">${escape(t("noWorkspaces"))}</p>` : "";
  const projectEmpty = draft.workspaceSlug && draft.projects.length === 0 ? `<p class="warning">${escape(t("noProjects"))}</p>` : "";
  const workItemEmpty = draft.projectId && draft.workItems.length === 0 ? `<p class="warning">${escape(t("noWorkItems"))}</p>` : "";
  const discovery = draft.user ? `<section>
    <label for="workspace">${escape(t("workspace"))}</label>
    <select id="workspace"${disabled(isBusy || draft.workspaces.length === 0)}>${optionList(draft.workspaces, draft.workspaceSlug, item => item.name, item => item.slug, "selectWorkspace")}</select>
    ${workspaceEmpty}
    <label for="project">${escape(t("project"))}</label>
    <select id="project"${disabled(isBusy || draft.projects.length === 0)}>${optionList(draft.projects, draft.projectId, item => item.identifier ? `${item.identifier} — ${item.name}` : item.name, item => item.id, "selectProject")}</select>
    ${projectEmpty}
    <label for="workItem">${escape(t("workItem"))}</label>
    <select id="workItem"${disabled(isBusy || draft.workItems.length === 0)}>${optionList(draft.workItems, draft.workItemId, item => `${item.identifier} — ${item.name}`, item => item.id, "selectWorkItem")}</select>
    ${workItemEmpty}
    <button data-action="bind"${disabled(isBusy || !draft.workspaceSlug || !draft.projectId || !draft.workItemId)}>${escape(t("bindSequence"))}</button>
  </section>` : "";

  const connection = draft.user ? "" : `<section class="connection-prompt"><h2>${escape(t("connectionTitle"))}</h2><p>${escape(t("connectionSettingsIntro"))}</p><button data-action="open-settings"${disabled(isBusy)}>${escape(t("openSettings"))}</button></section>`;
  root.innerHTML = shell(`${connection}${feedback()}${user}${discovery}`);
}
function renderUnlinkedReview(review: Extract<AssetReviewState, { linked: false }>): string {
  if (!review.canManage) {
    return `<section><h2>${escape(t("assetLinkTitle"))}</h2><p class="warning">${escape(t("assetUnlinked"))}</p><p>${escape(t("assetManageRequired"))}</p></section>`;
  }
  const catalog = assetDraft.assets.length > 0 ? `<label for="assetSelect">${escape(t("existingAsset"))}</label>
    <select id="assetSelect"${disabled(Boolean(busyKey))}>${optionList(assetDraft.assets, assetDraft.selectedAssetId, item => item.name, item => item.id, "selectAsset")}</select>
    <button data-action="link-asset"${disabled(Boolean(busyKey) || !assetDraft.selectedAssetId)}>${escape(t("linkAsset"))}</button>` : assetDraft.searched ? `<p class="warning">${escape(t("noCompatibleAssets"))}</p>` : "";
  return `<section><h2>${escape(t("assetLinkTitle"))}</h2><p class="warning">${escape(t("assetUnlinked"))}</p>
    <label for="assetQuery">${escape(t("assetSearch"))}</label>
    <input id="assetQuery" maxlength="100" value="${escape(assetDraft.query)}"${disabled(Boolean(busyKey))}>
    <button data-action="search-assets" class="secondary"${disabled(Boolean(busyKey))}>${escape(t("searchAssets"))}</button>
    ${catalog}
    <div class="separator"></div>
    <label for="assetName">${escape(t("newAssetName"))}</label>
    <input id="assetName" maxlength="255" value="${escape(assetDraft.newAssetName)}"${disabled(Boolean(busyKey))}>
    <button data-action="create-asset"${disabled(Boolean(busyKey) || !assetDraft.newAssetName.trim())}>${escape(t("createAndLinkAsset"))}</button>
  </section>`;
}
function renderLinkedReview(review: Extract<AssetReviewState, { linked: true }>): string {
  const currentVersion = review.versions[0];
  const version = currentVersion
    ? `<p><strong>${escape(t("currentVersion"))}:</strong> ${currentVersion.version_number}<br><strong>${escape(t("processingStatus"))}:</strong> ${escape(currentVersion.processing_status)}</p>`
    : `<p class="hint">${escape(t("noVersions"))}</p>`;
  let unlink = "";
  if (review.permissions.manage && assetDraft.confirmUnlink) {
    unlink = `<div class="confirmation"><p class="warning">${escape(t("confirmRemoteUnlink"))}</p><div class="actions"><button data-action="cancel-unlink" class="secondary"${disabled(Boolean(busyKey))}>${escape(t("cancel"))}</button><button data-action="confirm-unlink" class="danger"${disabled(Boolean(busyKey))}>${escape(t("confirmUnlink"))}</button></div></div>`;
  } else if (review.permissions.manage) {
    unlink = `<button data-action="request-unlink" class="danger"${disabled(Boolean(busyKey))}>${escape(t("unlinkRemote"))}</button><p class="hint">${escape(t("unlinkRemoteHint"))}</p>`;
  } else {
    unlink = `<p class="hint">${escape(t("assetManageRequired"))}</p>`;
  }
  return `<section><h2>${escape(t("assetLinkTitle"))}</h2><p><strong>${escape(t("linkedAsset"))}:</strong> ${escape(review.asset.name)}</p>${version}${unlink}</section>`;
}
function renderUpload(review: Extract<AssetReviewState, { linked: true }>): string {
  if (!review.permissions.upload) return `<section><h2>${escape(t("uploadTitle"))}</h2><p class="hint">${escape(t("uploadPermissionRequired"))}</p></section>`;
  const running = transferRunning();
  const selectedFile = selectedMedia
    ? `<p><strong>${escape(t("selectedFile"))}:</strong> ${escape(selectedMedia.name)}<br><strong>${escape(t("fileSize"))}:</strong> ${escape(fileSize(selectedMedia.size))}</p>`
    : `<p class="hint">${escape(t("noFileSelected"))}</p>`;
  const prepared = preparedExport
    ? `<p><strong>${escape(t("exportPreset"))}:</strong> ${escape(preparedExport.presetName)}<br><strong>${escape(t("outputPath"))}:</strong> ${escape(preparedExport.outputPath)}</p>`
    : `<p class="hint">${escape(t("noExportPrepared"))}</p>`;
  const direct = directExporter.supports()
    ? `${prepared}<button data-action="prepare-export" class="secondary"${disabled(running || Boolean(busyKey))}>${escape(t("choosePresetOutput"))}</button><button data-action="export-upload"${disabled(running || !preparedExport || Boolean(busyKey))}>${escape(t("exportAndUpload"))}</button><p class="hint">${escape(t("directExportSmokeHint"))}</p>`
    : `<p class="hint">${escape(t("directExportUnavailable"))}</p>`;
  const progress = Math.max(0, Math.min(100, Math.round(transfer.progress * 100)));
  const transferView = `<p><strong>${escape(t("transferStage"))}:</strong> ${escape(t(transferStageKey()))}<br><strong>${escape(t("progress"))}:</strong> ${progress}%${transfer.processingStatus ? `<br><strong>${escape(t("processingStatus"))}:</strong> ${escape(transfer.processingStatus)}` : ""}</p>${running ? `<button data-action="cancel-transfer" class="danger">${escape(t("cancelTransfer"))}</button>` : ""}`;
  return `<section><h2>${escape(t("uploadTitle"))}</h2><h3>${escape(t("exportedFileFallback"))}</h3>${selectedFile}<button data-action="select-media" class="secondary"${disabled(running || Boolean(busyKey))}>${escape(t("selectExportedFile"))}</button><button data-action="upload-selected"${disabled(running || !selectedMedia || Boolean(busyKey))}>${escape(t("uploadSelected"))}</button><div class="separator"></div><h3>${escape(t("directExport"))}</h3>${direct}<div class="separator"></div>${transferView}</section>`;
}
function renderAssetReview(): string {
  if (!bound?.review) return `<section><h2>${escape(t("assetLinkTitle"))}</h2><p class="warning">${escape(t("reviewUnavailable"))}</p></section>`;
  return bound.review.linked ? `${renderLinkedReview(bound.review)}${renderUpload(bound.review)}` : renderUnlinkedReview(bound.review);
}
function renderBound(): void {
  if (!sequence || !bound) return;
  root.innerHTML = shell(`<section><h2>${escape(t("boundTitle"))}</h2>
    <p><strong>${escape(t("sequence"))}:</strong> ${escape(sequence.name)}</p>
    <p><strong>${escape(t("boundAs"))}:</strong> ${escape(bound.user.displayName)} · ${escape(bound.user.email)}</p>
    <p><strong>${escape(t("boundWorkItem"))}:</strong> ${escape(bound.workItem.identifier)} — ${escape(bound.workItem.name)}</p>
    ${feedback()}
    <div class="actions"><button data-action="refresh" class="secondary"${disabled(Boolean(busyKey))}>${escape(t("refresh"))}</button><button data-action="disconnect" class="danger"${disabled(Boolean(busyKey))}>${escape(t("disconnectLocal"))}</button></div>
    <p class="hint">${escape(t("disconnectLocalHint"))}</p>
  </section>${renderAssetReview()}`);
}
function render(): void {
  if (context.status === "no-project") return renderHostMessage("noProject");
  if (context.status === "no-sequence") return renderHostMessage("noSequence");
  if (bound) renderBound(); else renderConnection();
}
function captureForm(): void {
  const workspaceSlug = value("workspace");
  const projectId = value("project");
  const workItemId = value("workItem");
  if (workspaceSlug) draft.workspaceSlug = workspaceSlug;
  if (projectId) draft.projectId = projectId;
  if (workItemId) draft.workItemId = workItemId;
}
function captureAssetForm(): void {
  const query = value("assetQuery");
  const selectedAssetId = value("assetSelect");
  const newAssetName = value("assetName");
  if (root.querySelector("#assetQuery")) assetDraft.query = query;
  if (root.querySelector("#assetSelect")) assetDraft.selectedAssetId = selectedAssetId;
  if (root.querySelector("#assetName")) assetDraft.newAssetName = newAssetName;
}
async function tokenForDraft(): Promise<string | undefined> {
  if (draft.token) return draft.token;
  if (!draft.baseUrl) return undefined;
  return store.getToken(draft.baseUrl);
}
async function loadProjects(preferredProject = "", preferredWorkItem = "", generation?: number): Promise<void> {
  if (!draft.client || !draft.workspaceSlug) { draft.projects = []; draft.workItems = []; return; }
  const projects = await draft.client.getProjects(draft.workspaceSlug);
  if (generation !== undefined) contextOperations.assertCurrent(generation);
  draft.projects = projects;
  draft.projectId = draft.projects.some(item => item.id === preferredProject) ? preferredProject : draft.projects[0]?.id ?? "";
  await loadWorkItems(preferredWorkItem, generation);
}
async function loadWorkItems(preferredWorkItem = "", generation?: number): Promise<void> {
  if (!draft.client || !draft.workspaceSlug || !draft.projectId) { draft.workItems = []; draft.workItemId = ""; return; }
  const workItems = await draft.client.getIssues(draft.workspaceSlug, draft.projectId);
  if (generation !== undefined) contextOperations.assertCurrent(generation);
  draft.workItems = workItems;
  draft.workItemId = draft.workItems.some(item => item.id === preferredWorkItem) ? preferredWorkItem : draft.workItems[0]?.id ?? "";
}
async function validateConnection(generation = contextOperations.begin()): Promise<void> {
  captureForm();
  errorKey = undefined; noticeKey = undefined; busyKey = "validatingConnection"; render();
  try {
    const token = await tokenForDraft();
    contextOperations.assertCurrent(generation);
    if (!token) { errorKey = "missingCredential"; return; }
    const client = new PlaneClient(draft.baseUrl, token);
    const { user, workspaces } = await client.validate();
    contextOperations.assertCurrent(generation);
    draft.client = client; draft.token = token; draft.user = user; draft.workspaces = workspaces;
    const preferredWorkspace = draft.workspaceSlug;
    draft.workspaceSlug = workspaces.some(item => item.slug === preferredWorkspace) ? preferredWorkspace : workspaces[0]?.slug ?? "";
    await loadProjects(draft.projectId, draft.workItemId, generation);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    draft.client = undefined; draft.user = undefined; draft.workspaces = []; draft.projects = []; draft.workItems = [];
    errorKey = "connectionError";
  } finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function changeWorkspace(): Promise<void> {
  const generation = contextOperations.begin();
  captureForm();
  if (!draft.client) return;
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try { await loadProjects("", "", generation); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { errorKey = "discoveryError"; draft.projects = []; draft.workItems = []; } }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function changeProject(): Promise<void> {
  const generation = contextOperations.begin();
  captureForm();
  if (!draft.client) return;
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try { await loadWorkItems("", generation); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { errorKey = "discoveryError"; draft.workItems = []; } }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function loadBoundReview(generation?: number): Promise<void> {
  if (!bound) return;
  const current = bound;
  const review = await loadAssetReview(current.binding, current.client, current.sessions);
  if (generation !== undefined) contextOperations.assertCurrent(generation);
  if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
  bound.review = review;
  if (bound.review.linked) assetDraft = emptyAssetDraft();
}
async function bindSequence(): Promise<void> {
  if (!sequence) return;
  const generation = contextOperations.begin();
  captureForm();
  errorKey = undefined; noticeKey = undefined; busyKey = "bindingSequence"; render();
  try {
    const token = await tokenForDraft();
    contextOperations.assertCurrent(generation);
    if (!token || !draft.client || !draft.user || !draft.workspaceSlug || !draft.projectId || !draft.workItemId) throw new Error();
    const workItem = await draft.client.getWorkItem(draft.workspaceSlug, draft.projectId, draft.workItemId);
    contextOperations.assertCurrent(generation);
    const binding: SequenceBinding = { projectGuid: sequence.projectGuid, sequenceId: sequence.id, baseUrl: draft.baseUrl, workspaceSlug: draft.workspaceSlug, projectId: draft.projectId, workItemId: draft.workItemId };
    await store.saveToken(binding.baseUrl, token);
    store.save(binding);
    const client = draft.client;
    bound = { binding, user: draft.user, workItem, client, sessions: new ReviewSessionManager(client) };
    draft = emptyDraft(); assetDraft = emptyAssetDraft();
    try { await loadBoundReview(generation); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = "reviewLoadError"; }
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = "bindingError"; }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function restoreBinding(binding: SequenceBinding, generation?: number): Promise<void> {
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try {
    const token = await store.getToken(binding.baseUrl);
    if (generation !== undefined) contextOperations.assertCurrent(generation);
    if (!token) { draft = emptyDraft(binding); errorKey = "missingCredential"; return; }
    const client = new PlaneClient(binding.baseUrl, token);
    const [user, workItem] = await Promise.all([client.getCurrentUser(), client.getWorkItem(binding.workspaceSlug, binding.projectId, binding.workItemId)]);
    if (generation !== undefined) contextOperations.assertCurrent(generation);
    bound = { binding, user, workItem, client, sessions: new ReviewSessionManager(client) };
    assetDraft = emptyAssetDraft();
    try { await loadBoundReview(generation); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = "reviewLoadError"; }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    bound = undefined; draft = emptyDraft(binding); errorKey = "restoreError";
  }
  finally { if (generation === undefined || contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function refreshBound(): Promise<void> {
  if (!bound) return;
  const generation = contextOperations.begin();
  const current = bound;
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try {
    const [user, workItem] = await Promise.all([
      current.client.getCurrentUser(),
      current.client.getWorkItem(current.binding.workspaceSlug, current.binding.projectId, current.binding.workItemId),
    ]);
    contextOperations.assertCurrent(generation);
    if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
    bound.user = user; bound.workItem = workItem;
    await loadBoundReview(generation);
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = "reviewLoadError"; }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
function disconnectLocal(): void {
  if (!bound) return;
  contextOperations.invalidate();
  const binding = bound.binding;
  resetTransferState();
  bound.sessions.clear();
  store.disconnect(binding.projectGuid, binding.sequenceId);
  bound = undefined; draft = emptyDraft(binding); assetDraft = emptyAssetDraft(); errorKey = undefined; noticeKey = "localDisconnected"; busyKey = undefined; render();
}
async function searchAssets(): Promise<void> {
  if (!bound?.review || bound.review.linked || !bound.review.canManage) return;
  const generation = contextOperations.begin();
  const current = bound;
  captureAssetForm(); errorKey = undefined; noticeKey = undefined; busyKey = "searchingAssets"; render();
  try {
    const assets = await current.client.searchAssets(current.binding.workspaceSlug, current.binding.projectId, current.binding.workItemId, assetDraft.query);
    contextOperations.assertCurrent(generation);
    if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
    assetDraft.assets = compatibleVideoAssets(assets);
    assetDraft.searched = true;
    assetDraft.selectedAssetId = assetDraft.assets.some(asset => asset.id === assetDraft.selectedAssetId) ? assetDraft.selectedAssetId : assetDraft.assets[0]?.id ?? "";
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { assetDraft.assets = []; assetDraft.selectedAssetId = ""; assetDraft.searched = true; errorKey = "assetCatalogError"; } }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function linkSelectedAsset(): Promise<void> {
  if (!bound?.review || bound.review.linked || !bound.review.canManage) return;
  const generation = contextOperations.begin();
  const current = bound;
  captureAssetForm();
  const asset = assetDraft.assets.find(item => item.id === assetDraft.selectedAssetId);
  if (!asset) { errorKey = "selectAssetRequired"; render(); return; }
  errorKey = undefined; noticeKey = undefined; busyKey = "linkingAsset"; render();
  try {
    const review = await linkAssetAndConfirm(current.binding, current.client, current.sessions, asset);
    contextOperations.assertCurrent(generation);
    if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
    bound.review = review;
    resetTransferState(); assetDraft = emptyAssetDraft(); noticeKey = "assetLinked";
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = error instanceof PlaneError && error.status === 409 ? "assetConflict" : "assetLinkError"; }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function createAndLinkAsset(): Promise<void> {
  if (!bound?.review || bound.review.linked || !bound.review.canManage) return;
  const generation = contextOperations.begin();
  const current = bound;
  captureAssetForm();
  if (!assetDraft.newAssetName) { errorKey = "assetNameRequired"; render(); return; }
  errorKey = undefined; noticeKey = undefined; busyKey = "creatingAsset"; render();
  try {
    const review = await createVideoAssetAndLink(current.binding, current.client, current.sessions, assetDraft.newAssetName);
    contextOperations.assertCurrent(generation);
    if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
    bound.review = review;
    resetTransferState(); assetDraft = emptyAssetDraft(); noticeKey = "assetCreatedLinked";
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = error instanceof PlaneError && error.status === 409 ? "assetConflict" : "assetCreateError"; }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
function requestRemoteUnlink(): void {
  if (!bound?.review?.linked || !bound.review.permissions.manage) return;
  assetDraft.confirmUnlink = true; errorKey = undefined; noticeKey = undefined; render();
}
function cancelRemoteUnlink(): void { assetDraft.confirmUnlink = false; render(); }
async function confirmRemoteUnlink(): Promise<void> {
  if (!bound?.review?.linked || !bound.review.permissions.manage) return;
  const generation = contextOperations.begin();
  const owner = bound;
  const current = bound.review;
  errorKey = undefined; noticeKey = undefined; busyKey = "unlinkingAsset"; render();
  try {
    const review = await unlinkAssetAndConfirm(owner.binding, owner.client, owner.sessions, current);
    contextOperations.assertCurrent(generation);
    if (bound !== owner) throw new DOMException("Review binding changed", "AbortError");
    bound.review = review;
    resetTransferState(); assetDraft = emptyAssetDraft(); noticeKey = "assetUnlinkedConfirmed";
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { errorKey = "assetUnlinkError"; assetDraft.confirmUnlink = false; } }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function selectExportedMedia(): Promise<void> {
  if (!bound?.review?.linked || !bound.review.permissions.upload || transferRunning()) return;
  const generation = contextOperations.begin();
  const current = bound;
  errorKey = undefined; noticeKey = undefined; busyKey = "selectingMedia"; render();
  try {
    const file = await mediaFiles.selectExported();
    contextOperations.assertCurrent(generation);
    if (bound !== current) throw new DOMException("Review binding changed", "AbortError");
    if (file) { selectedMedia = file; noticeKey = "mediaSelected"; }
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) errorKey = "mediaSelectionError"; }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}
async function prepareDirectExport(): Promise<void> {
  if (!sequence || !bound?.review?.linked || !bound.review.permissions.upload || transferRunning()) return;
  errorKey = undefined; noticeKey = undefined; busyKey = "preparingExport"; render();
  try {
    const prepared = await directExporter.prepare(sequence.projectGuid, sequence.id, sequence.name);
    if (prepared) { preparedExport = prepared; noticeKey = "exportPrepared"; }
  } catch { errorKey = "exportPrepareError"; }
  finally { busyKey = undefined; render(); }
}
async function runTransfer(source: SelectedMediaFile | ((signal: AbortSignal) => Promise<SelectedMediaFile>)): Promise<void> {
  if (!bound?.review?.linked || !bound.review.permissions.upload || transferRunning()) return;
  errorKey = undefined; noticeKey = undefined;
  try {
    const active = await bound.sessions.get(bound.binding);
    if (!active || active.assetId !== bound.review.asset.id) throw new Error();
    const controller = new ReviewUploadController(active.freeframe);
    transferController = controller;
    const transferBinding = { ...bound.binding };
    await controller.run(active.assetId, { projectId: transferBinding.projectId, issueId: transferBinding.workItemId }, source, {
      onChange: value => { transfer = value; render(); },
      validateContext: async () => {
        const current = await premiere.context();
        if (current.status !== "ready" || current.sequence.projectGuid !== transferBinding.projectGuid || current.sequence.id !== transferBinding.sequenceId) throw new Error("Active Premiere sequence changed during transfer");
        if (!bound || bound.binding.projectGuid !== transferBinding.projectGuid || bound.binding.sequenceId !== transferBinding.sequenceId || bound.binding.projectId !== transferBinding.projectId || bound.binding.workItemId !== transferBinding.workItemId) throw new Error("Plane review binding changed during transfer");
      },
    });
    noticeKey = "transferReadyNotice";
    await loadBoundReview();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") noticeKey = "transferCancelledNotice";
    else if (error instanceof ProcessingContinuesError) noticeKey = "transferProcessingBackgroundNotice";
    else errorKey = "transferError";
  } finally { transferController = undefined; render(); }
}
function uploadSelectedMedia(): void { if (selectedMedia) void runTransfer(selectedMedia); }
function exportAndUpload(): void { if (preparedExport) void runTransfer(async signal => mediaFiles.read(await directExporter.export(preparedExport!, { signal }), "exported", signal)); }
function cancelTransfer(): void { transferController?.cancel(); }

async function start(): Promise<void> {
  const generation = contextOperations.begin();
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try {
    const nextContext = await premiere.context();
    contextOperations.assertCurrent(generation);
    context = nextContext;
    sequence = context.status === "ready" ? context.sequence : undefined;
    if (!sequence) return;
    const binding = store.get(sequence.projectGuid, sequence.id);
    if (binding) await restoreBinding(binding, generation); else {
      draft = emptyDraft(); assetDraft = emptyAssetDraft(); bound = undefined;
      if (draft.baseUrl && await store.getToken(draft.baseUrl)) { contextOperations.assertCurrent(generation); await validateConnection(generation); }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) { context = { status: "no-project" }; sequence = undefined; errorKey = "hostError"; }
  }
  finally { if (contextOperations.current(generation)) { busyKey = undefined; render(); } }
}

root.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const action = target.dataset.action;
  if (!action || busyKey) return;
  if (action === "validate") void validateConnection();
  if (action === "open-settings") requestShellView("settings");
  if (action === "bind") void bindSequence();
  if (action === "refresh") void refreshBound();
  if (action === "disconnect") disconnectLocal();
  if (action === "search-assets") void searchAssets();
  if (action === "link-asset") void linkSelectedAsset();
  if (action === "create-asset") void createAndLinkAsset();
  if (action === "request-unlink") requestRemoteUnlink();
  if (action === "cancel-unlink") cancelRemoteUnlink();
  if (action === "confirm-unlink") void confirmRemoteUnlink();
  if (action === "select-media") void selectExportedMedia();
  if (action === "prepare-export") void prepareDirectExport();
  if (action === "upload-selected") uploadSelectedMedia();
  if (action === "export-upload") exportAndUpload();
  if (action === "cancel-transfer") cancelTransfer();
});
root.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (busyKey) return;
  if (target.id === "workspace") void changeWorkspace();
  if (target.id === "project") void changeProject();
  if (target.id === "workItem") draft.workItemId = target.value;
  if (target.id === "assetSelect") assetDraft.selectedAssetId = target.value;
});
root.addEventListener("input", event => {
  const target = event.target as HTMLInputElement;
  if (target.id === "assetQuery") assetDraft.query = target.value;
  if (target.id === "assetName") assetDraft.newAssetName = target.value;
});

window.addEventListener("unload", () => resetTransferState());
window.addEventListener(INTERFACE_LOCALE_EVENT, () => { captureForm(); captureAssetForm(); render(); });
window.addEventListener(ACTIVE_CONTEXT_EVENT, () => { resetTransferState(); void start(); });
window.addEventListener(USER_CONFIG_EVENT, event => { if ((event as CustomEvent<unknown>).detail === "plane") void start(); });

void start();
