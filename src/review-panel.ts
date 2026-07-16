import { loadAssetReview, type AssetReviewState } from "./asset-workflow";
import type { ReviewVersion, SequenceBinding, SequenceInfo, WorkItem } from "./domain";
import { type MessageKey, t } from "./locale";
import { BindingStore } from "./persistence";
import { PlaneClient } from "./plane-client";
import { PremiereAdapter } from "./premiere";
import { PremiereMarkerAdapter, type PremiereMarkerSyncResult } from "./premiere-markers";
import { createCommentAtPlayhead, loadVersionComments, setCommentResolved, type PositionedReviewComment } from "./review-comments";
import { buildReviewMarkers } from "./review-markers";
import { ReviewSessionManager } from "./review-session";
import { ReviewTimingError } from "./review-timing";

const root = document.querySelector<HTMLDivElement>("#review-comments-app");
const store = new BindingStore();
const premiere = new PremiereAdapter();
const premiereMarkers = new PremiereMarkerAdapter();

interface MarkerSyncState extends PremiereMarkerSyncResult { skipped: number }
interface ReviewPanelState {
  sequence?: SequenceInfo;
  binding?: SequenceBinding;
  workItem?: WorkItem;
  client?: PlaneClient;
  sessions?: ReviewSessionManager;
  review?: AssetReviewState;
  selectedVersionId: string;
  comments: PositionedReviewComment[];
  body: string;
  markerSync?: MarkerSyncState;
  markersSyncedVersionId?: string;
  busyKey?: MessageKey;
  errorKey?: MessageKey;
  noticeKey?: MessageKey;
}

const state: ReviewPanelState = { selectedVersionId: "", comments: [], body: "" };
let request: AbortController | undefined;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const disabled = (condition: boolean) => condition ? " disabled" : "";

function selectedVersion(): ReviewVersion | undefined {
  return state.review?.linked ? state.review.versions.find(version => version.id === state.selectedVersionId) : undefined;
}
function frameLabel(item: PositionedReviewComment): string {
  if (item.position.status === "ready") return `${t("frame")} ${item.position.frameNumber}`;
  return t(({ untimed: "commentUntimed", "timing-unavailable": "commentTimingUnavailable", "timing-conflict": "commentTimingConflict", "outside-version": "commentOutsideVersion", "outside-sequence": "commentOutsideSequence" } as const)[item.position.status]);
}
function feedback(): string {
  const busy = state.busyKey ? `<p class="status">${escape(t(state.busyKey))}</p>` : "";
  const error = state.errorKey ? `<p class="error">${escape(t(state.errorKey))}</p>` : "";
  const notice = state.noticeKey ? `<p class="notice">${escape(t(state.noticeKey))}</p>` : "";
  return `${busy}${error}${notice}`;
}
function markerSummary(): string {
  if (!state.markerSync) return `<p class="hint">${escape(t("markerSyncHint"))}</p>`;
  const value = state.markerSync;
  return `<div class="marker-summary"><span>${escape(t("markersCreated"))}: ${value.created}</span><span>${escape(t("markersUpdated"))}: ${value.updated}</span><span>${escape(t("markersRemoved"))}: ${value.removed}</span><span>${escape(t("markersUnchanged"))}: ${value.unchanged}</span>${value.skipped ? `<span class="warning">${escape(t("markersSkipped"))}: ${value.skipped}</span>` : ""}</div>`;
}
function renderMarkerControls(version: ReviewVersion): string {
  if (!premiere.supportsMarkers()) return `<p class="hint">${escape(t("markersUnavailable"))}</p>`;
  const synced = state.markersSyncedVersionId === version.id ? `<span class="review-pill synced">${escape(t("markersSyncedState"))}</span>` : "";
  return `<div class="marker-controls"><div><strong>${escape(t("timelineMarkers"))}</strong>${synced}</div><button class="secondary compact" data-review-action="sync-markers"${disabled(Boolean(state.busyKey) || !state.workItem)}>${escape(t("syncMarkers"))}</button></div>${markerSummary()}`;
}
function renderComments(review: Extract<AssetReviewState, { linked: true }>, version: ReviewVersion): string {
  const list = state.comments.length === 0
    ? `<p class="hint">${escape(t("commentsEmpty"))}</p>`
    : `<div class="comment-list">${state.comments.map(item => {
      const author = item.comment.author?.name ?? item.comment.guest_author?.name ?? t("unknownAuthor");
      const toggle = review.permissions.comment
        ? `<button class="secondary compact" data-review-action="toggle-resolution" data-comment-id="${escape(item.comment.id)}" data-resolved="${String(!item.comment.resolved)}"${disabled(Boolean(state.busyKey))}>${escape(t(item.comment.resolved ? "reopen" : "resolve"))}</button>`
        : "";
      const markerEligible = item.position.status === "ready" ? `<span class="review-pill marker-ready">${escape(t("markerReady"))}</span>` : "";
      return `<article class="comment-card${item.comment.resolved ? " resolved" : ""}"><div class="comment-meta"><div><strong>${escape(author)}</strong><span class="review-pill${item.comment.resolved ? " resolved-pill" : ""}">${escape(t(item.comment.resolved ? "resolved" : "open"))}</span>${markerEligible}</div><span>${escape(frameLabel(item))}</span></div><p>${escape(item.comment.body)}</p>${toggle}</article>`;
    }).join("")}</div>`;
  const timing = version.fps_numerator && version.fps_denominator
    ? `<p class="hint">${escape(t("versionTiming"))}: ${version.fps_numerator}/${version.fps_denominator}${typeof version.duration_seconds === "number" ? ` · ${version.duration_seconds.toFixed(3)}` : ""}</p>`
    : `<p class="warning">${escape(t("commentTimingUnavailable"))}</p>`;
  const composer = review.permissions.comment
    ? `<div class="comment-composer"><label for="reviewCommentBody">${escape(t("commentBody"))}</label><textarea id="reviewCommentBody" maxlength="5000"${disabled(Boolean(state.busyKey))}>${escape(state.body)}</textarea><button data-review-action="create-comment"${disabled(Boolean(state.busyKey) || !state.body.trim())}>${escape(t("createAtPlayhead"))}</button></div>`
    : `<p class="hint">${escape(t("commentPermissionRequired"))}</p>`;
  return `${timing}${renderMarkerControls(version)}${list}<div class="separator"></div>${composer}`;
}
function render(): void {
  if (!root) return;
  if (!state.sequence) {
    root.innerHTML = `<section><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(t("noSequence"))}</p>${feedback()}</section>`;
    return;
  }
  if (!state.binding) {
    root.innerHTML = `<section><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(t("reviewPanelNeedsBinding"))}</p>${feedback()}</section>`;
    return;
  }
  if (!state.review) {
    root.innerHTML = `<section><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(t("commentLoadError"))}</p><button class="secondary" data-review-action="refresh">${escape(t("refresh"))}</button>${feedback()}</section>`;
    return;
  }
  if (!state.review.linked) {
    root.innerHTML = `<section><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(t("assetUnlinked"))}</p><button class="secondary" data-review-action="refresh">${escape(t("refresh"))}</button>${feedback()}</section>`;
    return;
  }
  const review = state.review;
  if (review.versions.length === 0) {
    root.innerHTML = `<section><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(t("noReviewVersions"))}</p><button class="secondary" data-review-action="refresh">${escape(t("refresh"))}</button>${feedback()}</section>`;
    return;
  }
  const version = selectedVersion() ?? review.versions[0];
  const options = review.versions.map(item => `<option value="${escape(item.id)}"${item.id === version.id ? " selected" : ""}>${escape(`${t("reviewVersion")} ${item.version_number} · ${item.processing_status}`)}</option>`).join("");
  root.innerHTML = `<section class="review-surface"><div class="review-heading"><div><h2>${escape(t("reviewTitle"))}</h2><p class="hint">${escape(state.sequence.name)}${state.workItem ? ` · ${escape(state.workItem.identifier)}` : ""}</p></div><button class="secondary compact" data-review-action="refresh"${disabled(Boolean(state.busyKey))}>${escape(t("refresh"))}</button></div><div class="review-version-row"><label for="reviewVersionSelect">${escape(t("reviewVersion"))}</label><select id="reviewVersionSelect"${disabled(Boolean(state.busyKey))}>${options}</select></div>${feedback()}${renderComments(review, version)}</section>`;
}
async function validateContext(binding: SequenceBinding): Promise<void> {
  const current = await premiere.context();
  if (current.status !== "ready" || current.sequence.projectGuid !== binding.projectGuid || current.sequence.id !== binding.sequenceId) throw new Error("Premiere review context changed");
  const stored = store.get(binding.projectGuid, binding.sequenceId);
  if (!stored || stored.baseUrl !== binding.baseUrl || stored.workspaceSlug !== binding.workspaceSlug || stored.projectId !== binding.projectId || stored.workItemId !== binding.workItemId) throw new Error("Plane review binding changed");
}
async function loadComments(): Promise<void> {
  if (!state.binding || !state.review?.linked || !state.sessions || !state.sequence) return;
  const version = selectedVersion();
  if (!version) return;
  const active = await state.sessions.get(state.binding);
  if (!active || active.assetId !== state.review.asset.id) throw new Error("Review session does not match the linked asset");
  state.comments = await loadVersionComments(active.freeframe, active.assetId, version, { sequenceDurationSeconds: state.sequence.durationSeconds, signal: request?.signal });
}
async function reconcileSelectedMarkers(): Promise<void> {
  if (!state.binding || !state.review?.linked || !state.sequence || !state.workItem) throw new Error("Marker reconciliation context is unavailable");
  const version = selectedVersion();
  if (!version) throw new Error("No selected review version");
  const built = buildReviewMarkers(state.review.asset.id, version, state.workItem.identifier, state.comments, {
    open: t("open"),
    resolved: t("resolved"),
    author: t("markerAuthor"),
    status: t("markerStatus"),
    freeframeComment: t("markerCommentId"),
  });
  const result = await premiereMarkers.reconcile(
    state.binding.projectGuid,
    state.binding.sequenceId,
    built.markers,
    { assetId: state.review.asset.id, versionId: version.id },
    t("markerUndoLabel"),
  );
  state.markerSync = { ...result, skipped: built.skipped };
  state.markersSyncedVersionId = version.id;
}
async function start(): Promise<void> {
  const previousAssetId = state.review?.linked ? state.review.asset.id : undefined;
  const previousSyncedVersionId = state.markersSyncedVersionId;
  request?.abort();
  request = new AbortController();
  state.errorKey = undefined; state.noticeKey = undefined; state.busyKey = "commentsLoading"; render();
  try {
    const context = await premiere.context();
    state.sequence = context.status === "ready" ? context.sequence : undefined;
    state.binding = state.sequence ? store.get(state.sequence.projectGuid, state.sequence.id) : undefined;
    state.client = undefined; state.sessions = undefined; state.review = undefined; state.workItem = undefined; state.comments = [];
    if (!state.sequence || !state.binding) return;
    const token = await store.getToken(state.binding.baseUrl);
    if (!token) { state.errorKey = "missingCredential"; return; }
    const client = new PlaneClient(state.binding.baseUrl, token);
    const sessions = new ReviewSessionManager(client);
    state.client = client; state.sessions = sessions;
    const [review, workItem] = await Promise.all([
      loadAssetReview(state.binding, client, sessions),
      client.getWorkItem(state.binding.workspaceSlug, state.binding.projectId, state.binding.workItemId),
    ]);
    state.review = review; state.workItem = workItem;
    if (!review.linked) { state.selectedVersionId = ""; state.markersSyncedVersionId = undefined; state.markerSync = undefined; return; }
    const previous = state.selectedVersionId;
    state.selectedVersionId = review.versions.some(version => version.id === previous) ? previous : review.versions[0]?.id ?? "";
    if (review.asset.id !== previousAssetId) { state.markersSyncedVersionId = undefined; state.markerSync = undefined; }
    await loadComments();
    if (previousSyncedVersionId === state.selectedVersionId && review.asset.id === previousAssetId) await reconcileSelectedMarkers();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) state.errorKey = "commentLoadError";
  } finally { state.busyKey = undefined; render(); }
}
async function syncMarkers(): Promise<void> {
  if (!state.binding || !state.review?.linked || !state.sequence || state.busyKey) return;
  state.errorKey = undefined; state.noticeKey = undefined; state.busyKey = "markersSyncing"; render();
  try {
    await validateContext(state.binding);
    await reconcileSelectedMarkers();
    await validateContext(state.binding);
    state.noticeKey = "markersSynced";
  } catch {
    state.errorKey = "markerSyncError";
  } finally { state.busyKey = undefined; render(); }
}
async function createComment(): Promise<void> {
  if (!state.binding || !state.review?.linked || !state.review.permissions.comment || !state.sessions || !state.sequence || state.busyKey) return;
  const version = selectedVersion();
  if (!version) return;
  const body = state.body.trim();
  if (!body) { state.errorKey = "commentBodyRequired"; render(); return; }
  const keepMarkersSynced = state.markersSyncedVersionId === version.id;
  request?.abort(); const controller = new AbortController(); request = controller;
  state.errorKey = undefined; state.noticeKey = undefined; state.busyKey = "creatingComment"; render();
  try {
    await validateContext(state.binding);
    const playhead = await premiere.playhead(state.binding.projectGuid, state.binding.sequenceId);
    const active = await state.sessions.get(state.binding);
    if (!active || active.assetId !== state.review.asset.id) throw new Error("Review session does not match the linked asset");
    await createCommentAtPlayhead(active.freeframe, active.assetId, version, body, playhead.seconds, playhead.sequenceDurationSeconds ?? state.sequence.durationSeconds, controller.signal);
    await validateContext(state.binding);
    state.body = ""; await loadComments();
    if (keepMarkersSynced) await reconcileSelectedMarkers();
    state.noticeKey = "commentCreated";
  } catch (error) {
    if (error instanceof ReviewTimingError) state.errorKey = ({ "timing-unavailable": "commentTimingUnavailable", "outside-version": "commentOutsideVersion", "outside-sequence": "commentOutsideSequence", "invalid-playhead": "commentCreateError" } as const)[error.code];
    else if (!(error instanceof DOMException && error.name === "AbortError")) state.errorKey = "commentCreateError";
  } finally { if (request === controller) request = undefined; state.busyKey = undefined; render(); }
}
async function toggleResolution(commentId: string, resolved: boolean): Promise<void> {
  if (!state.binding || !state.review?.linked || !state.review.permissions.comment || !state.sessions || state.busyKey) return;
  const version = selectedVersion(), item = state.comments.find(candidate => candidate.comment.id === commentId);
  if (!version || !item) return;
  const keepMarkersSynced = state.markersSyncedVersionId === version.id;
  request?.abort(); const controller = new AbortController(); request = controller;
  state.errorKey = undefined; state.noticeKey = undefined; state.busyKey = "updatingResolution"; render();
  try {
    await validateContext(state.binding);
    const active = await state.sessions.get(state.binding);
    if (!active || active.assetId !== state.review.asset.id) throw new Error("Review session does not match the linked asset");
    await setCommentResolved(active.freeframe, active.assetId, version.id, item.comment, resolved, controller.signal);
    await validateContext(state.binding);
    await loadComments();
    if (keepMarkersSynced) await reconcileSelectedMarkers();
    state.noticeKey = "resolutionUpdated";
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) state.errorKey = "resolutionError";
  } finally { if (request === controller) request = undefined; state.busyKey = undefined; render(); }
}

root?.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const action = target.dataset.reviewAction;
  if (action === "refresh") void start();
  if (action === "sync-markers") void syncMarkers();
  if (action === "create-comment") void createComment();
  if (action === "toggle-resolution") void toggleResolution(target.dataset.commentId ?? "", target.dataset.resolved === "true");
});
root?.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "reviewVersionSelect" && state.review?.linked && state.review.versions.some(version => version.id === target.value)) {
    state.selectedVersionId = target.value; state.comments = []; state.markerSync = undefined; state.markersSyncedVersionId = undefined; state.errorKey = undefined; state.noticeKey = undefined; state.busyKey = "commentsLoading"; render();
    void loadComments().catch(() => { state.errorKey = "commentLoadError"; }).finally(() => { state.busyKey = undefined; render(); });
  }
});
root?.addEventListener("input", event => {
  const target = event.target as HTMLTextAreaElement;
  if (target.id === "reviewCommentBody") state.body = target.value;
});
window.addEventListener("unload", () => { request?.abort(); state.sessions?.clear(); });
void start();
