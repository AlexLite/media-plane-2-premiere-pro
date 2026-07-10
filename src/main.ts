import type { PlaneComment, PlaneState, SequenceBinding, SequenceInfo, WorkItem } from "./domain";
import { BindingStore } from "./persistence";
import { PlaneClient } from "./plane-client";
import { markerKey, readIdentity, reconcileMarkers, type DesiredMarker } from "./markers";
import { PremiereAdapter } from "./premiere";

const root = document.querySelector<HTMLDivElement>("#app")!;
const store = new BindingStore(), premiere = new PremiereAdapter();
let sequence: SequenceInfo | undefined, binding: SequenceBinding | undefined, client: PlaneClient | undefined;
let issue: WorkItem | undefined, comments: PlaneComment[] = [], states: PlaneState[] = [], checked = new Set<string>();
let projects: Array<{ id: string; name: string; identifier?: string }> = [], issues: WorkItem[] = [];
let draft: Partial<SequenceBinding> = {};
let draftToken = "";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function active() { sequence = premiere.activeSequence(); binding = sequence && store.get(sequence.id); }
function message(text: string, cls = "muted") { root.innerHTML = `<p class="${cls}">${escape(text)}</p>`; }
function bindEvents() { root.querySelectorAll<HTMLElement>("[data-action]").forEach(el => el.addEventListener("click", () => void action(el.dataset.action!))); }
function connection(error = "") {
  active();
  if (!sequence) { root.innerHTML = `<h2>Plane Review</h2><p class="warning">Open or select a sequence in Premiere, then reopen this panel.</p>`; return; }
  root.innerHTML = `<h2>Connect sequence</h2><p class="muted">Binding: ${escape(sequence.name)}</p>${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label>Plane base URL<input id="baseUrl" placeholder="https://plane.example.com" value="${escape(draft.baseUrl ?? binding?.baseUrl ?? "")}"/></label>
  <label>Personal access token<input id="token" type="password" placeholder="Stored only in UXP secure storage" value="${escape(draftToken)}"/></label>
  <label>Workspace slug<input id="workspace" value="${escape(draft.workspaceSlug ?? binding?.workspaceSlug ?? "")}"/></label>
  <button class="secondary" data-action="discover">Load projects &amp; items</button>
  <label>Project ${projects.length ? `<select id="project">${projects.map(p => `<option value="${escape(p.id)}" ${(p.id === draft.projectId || p.id === binding?.projectId) ? "selected" : ""}>${escape(p.identifier ? `${p.identifier} — ${p.name}` : p.name)}</option>`).join("")}</select>` : `<input id="project" value="${escape(draft.projectId ?? binding?.projectId ?? "")}" placeholder="Load or enter project ID"/>`}</label>
  <label>Work item ${issues.length ? `<select id="workItem">${issues.map(i => `<option value="${escape(i.id)}" ${(i.id === draft.workItemId || i.id === binding?.workItemId) ? "selected" : ""}>${escape(i.identifier)} — ${escape(i.name)}</option>`).join("")}</select>` : `<input id="workItem" value="${escape(draft.workItemId ?? binding?.workItemId ?? "")}" placeholder="Load or enter work item ID"/>`}</label>
  <button data-action="connect">Validate, save &amp; open review</button>`; bindEvents();
}
async function load() {
  active(); if (!sequence) return connection(); if (!binding) return connection();
  const token = await store.getToken(binding.baseUrl); if (!token) return connection("No saved token for this Plane URL.");
  client = new PlaneClient(binding.baseUrl, token);
  const [loadedIssue, loadedComments, loadedStates] = await Promise.all([client.getWorkItem(binding.workspaceSlug, binding.projectId, binding.workItemId), client.getComments(binding.workspaceSlug, binding.projectId, binding.workItemId), client.getStates(binding.workspaceSlug, binding.projectId)]);
  issue = loadedIssue; comments = loadedComments; states = loadedStates;
  const markers = await premiere.markers().list(); checked = new Set();
  for (const comment of comments) for (const tc of comment.timecodes ?? []) {
    const identity = { commentId: comment.id, timecode: tc.value }; const exists = markers.some(m => markerKey(readIdentity(m.comments) ?? { commentId: "", timecode: "" }) === markerKey(identity));
    if (!exists) checked.add(markerKey(identity));
  }
  review();
}
function review(error = "") {
  if (!sequence || !binding || !issue) return connection(error);
  const options = states.map(s => `<option value="${escape(s.id)}" ${s.id === issue!.state_detail?.id || s.name === issue!.state ? "selected" : ""}>${escape(s.name)}</option>`).join("");
  const commentHtml = comments.map(comment => {
    const author = comment.actor_detail?.display_name ?? comment.actor_detail?.first_name ?? "Plane user";
    const list = (comment.timecodes ?? []).map(tc => {
      const key = markerKey({ commentId: comment.id, timecode: tc.value }); const out = tc.seconds > sequence!.durationSeconds;
      return `<label class="timecode"><input type="checkbox" data-key="${escape(key)}" ${checked.has(key) || out ? "checked" : ""} ${out ? "disabled" : ""}/><span>${escape(tc.value)}${out ? " <span class=\"warning\">(outside sequence)</span>" : ""}</span></label>`;
    }).join("");
    return list ? `<section class="comment"><h3>${escape(author)}</h3><p class="muted">${escape(plain(comment.comment_html).slice(0, 180))}</p>${list}</section>` : "";
  }).join("") || `<p class="muted">No Plane timecodes in this comment stream.</p>`;
  root.innerHTML = `<div class="row"><h2>${escape(sequence.name)}</h2><button class="secondary" data-action="refresh">Refresh</button></div><p>${escape(issue.identifier)} — ${escape(issue.name)}</p>${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label>Status<select id="status">${options}</select></label><button data-action="state">Update status</button>
  <label>Reply<textarea id="reply" placeholder="Write a Plane comment…"></textarea></label><button data-action="reply">Post reply</button><h3>Timecodes</h3>${commentHtml}`;
  bindEvents(); root.querySelectorAll<HTMLInputElement>("input[data-key]").forEach(box => box.addEventListener("change", () => void toggle(box.dataset.key!, box.checked)));
}
function desired(): DesiredMarker[] {
  return comments.flatMap(comment => (comment.timecodes ?? []).filter(tc => !checked.has(markerKey({ commentId: comment.id, timecode: tc.value })) && tc.seconds <= sequence!.durationSeconds).map(tc => ({ identity: { plugin: "plane-timecode-review", commentId: comment.id, timecode: tc.value }, startSeconds: tc.seconds, name: `${issue!.identifier} ${tc.value}`, comment: `${comment.actor_detail?.display_name ?? "Plane user"} · ${tc.value} · ${plain(comment.comment_html).slice(0, 160)}` })));
}
async function toggle(key: string, isChecked: boolean) { isChecked ? checked.add(key) : checked.delete(key); try { await reconcileMarkers(premiere.markers(), desired()); } catch (e) { review(String(e)); return; } review(); }
async function action(name: string) {
  try {
    if (name === "discover") { const value = (id: string) => (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim(); const baseUrl = value("baseUrl"), token = value("token"), workspace = value("workspace"); if (!baseUrl || !token || !workspace) throw new Error("Enter Plane URL, token, and workspace first."); draftToken = token; draft = { ...draft, baseUrl, workspaceSlug: workspace, projectId: value("project"), workItemId: value("workItem") }; const discovery = new PlaneClient(baseUrl, token); await discovery.validate(); projects = await discovery.getProjects(workspace); const selectedProject = draft.projectId || projects[0]?.id; draft.projectId = selectedProject; issues = selectedProject ? await discovery.getIssues(workspace, selectedProject) : []; connection(); }
    if (name === "connect") { const val = (id: string) => (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim(); const baseUrl = val("baseUrl"); const token = val("token"); const next = { sequenceId: sequence!.id, baseUrl, workspaceSlug: val("workspace"), projectId: val("project"), workItemId: val("workItem") }; if (!baseUrl || !token || !next.workspaceSlug || !next.projectId || !next.workItemId) throw new Error("Complete every connection field."); const validation = new PlaneClient(baseUrl, token); await validation.validate(); await store.saveToken(baseUrl, token); store.save(next); binding = next; draft = {}; draftToken = ""; message("Connected. Loading review…"); await load(); }
    if (name === "refresh") { message("Refreshing…"); await load(); }
    if (name === "state") { await client!.updateState(binding!.workspaceSlug, binding!.projectId, binding!.workItemId, root.querySelector<HTMLSelectElement>("#status")!.value); await load(); }
    if (name === "reply") { const text = root.querySelector<HTMLTextAreaElement>("#reply")!.value.trim(); if (!text) return; await client!.createComment(binding!.workspaceSlug, binding!.projectId, binding!.workItemId, `<p>${escape(text)}</p>`); await load(); }
  } catch (e) { const detail = e instanceof Error ? e.message : String(e); if (name === "connect" || name === "discover") connection(detail); else review(detail); }
}
void load().catch(e => connection(e instanceof Error ? e.message : String(e)));
