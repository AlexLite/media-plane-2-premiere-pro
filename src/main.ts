import type { PlaneUser, PremiereContext, ProjectSummary, SequenceBinding, SequenceInfo, WorkspaceSummary, WorkItem } from "./domain";
import { type MessageKey, t } from "./locale";
import { BindingStore } from "./persistence";
import { PlaneClient } from "./plane-client";
import { PremiereAdapter } from "./premiere";

const root = document.querySelector<HTMLDivElement>("#app")!;
const store = new BindingStore();
const premiere = new PremiereAdapter();

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
interface BoundState { binding: SequenceBinding; user: PlaneUser; workItem: WorkItem }

let context: PremiereContext = { status: "no-project" };
let sequence: SequenceInfo | undefined;
let bound: BoundState | undefined;
let draft: ConnectionDraft = emptyDraft();
let errorKey: MessageKey | undefined;
let noticeKey: MessageKey | undefined;
let busyKey: MessageKey | undefined;

function emptyDraft(binding?: SequenceBinding): ConnectionDraft {
  return {
    baseUrl: binding?.baseUrl ?? "",
    token: "",
    workspaces: [],
    projects: [],
    workItems: [],
    workspaceSlug: binding?.workspaceSlug ?? "",
    projectId: binding?.projectId ?? "",
    workItemId: binding?.workItemId ?? "",
  };
}
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const value = (id: string): string => (root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? "").trim();
const selected = (actual: string, expected: string): string => actual === expected ? " selected" : "";
const disabled = (condition: boolean): string => condition ? " disabled" : "";

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

  root.innerHTML = shell(`<section><h2>${escape(t("connectionTitle"))}</h2><p>${escape(t("connectionIntro"))}</p><p><strong>${escape(t("sequence"))}:</strong> ${escape(sequence.name)}</p>
    <label for="baseUrl">${escape(t("planeUrl"))}</label>
    <input id="baseUrl" type="url" value="${escape(draft.baseUrl)}"${disabled(isBusy)}>
    <label for="token">${escape(t("planePat"))}</label>
    <input id="token" type="password" autocomplete="off"${disabled(isBusy)}>
    <p class="hint">${escape(t("planePatHint"))}</p>
    <button data-action="validate" class="secondary"${disabled(isBusy)}>${escape(t("validateConnection"))}</button>
  </section>${feedback()}${user}${discovery}`);
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
  </section>`);
}
function render(): void {
  if (context.status === "no-project") return renderHostMessage("noProject");
  if (context.status === "no-sequence") return renderHostMessage("noSequence");
  if (bound) renderBound(); else renderConnection();
}
function captureForm(): void {
  const baseUrl = value("baseUrl");
  const token = value("token");
  if (baseUrl) draft.baseUrl = baseUrl;
  if (token) draft.token = token;
  const workspaceSlug = value("workspace");
  const projectId = value("project");
  const workItemId = value("workItem");
  if (workspaceSlug) draft.workspaceSlug = workspaceSlug;
  if (projectId) draft.projectId = projectId;
  if (workItemId) draft.workItemId = workItemId;
}
async function tokenForDraft(): Promise<string | undefined> {
  if (draft.token) return draft.token;
  if (!draft.baseUrl) return undefined;
  return store.getToken(draft.baseUrl);
}
async function loadProjects(preferredProject = "", preferredWorkItem = ""): Promise<void> {
  if (!draft.client || !draft.workspaceSlug) { draft.projects = []; draft.workItems = []; return; }
  draft.projects = await draft.client.getProjects(draft.workspaceSlug);
  draft.projectId = draft.projects.some(item => item.id === preferredProject) ? preferredProject : draft.projects[0]?.id ?? "";
  await loadWorkItems(preferredWorkItem);
}
async function loadWorkItems(preferredWorkItem = ""): Promise<void> {
  if (!draft.client || !draft.workspaceSlug || !draft.projectId) { draft.workItems = []; draft.workItemId = ""; return; }
  draft.workItems = await draft.client.getIssues(draft.workspaceSlug, draft.projectId);
  draft.workItemId = draft.workItems.some(item => item.id === preferredWorkItem) ? preferredWorkItem : draft.workItems[0]?.id ?? "";
}
async function validateConnection(): Promise<void> {
  captureForm();
  errorKey = undefined; noticeKey = undefined; busyKey = "validatingConnection"; render();
  try {
    const token = await tokenForDraft();
    if (!token) { errorKey = "missingCredential"; return; }
    const client = new PlaneClient(draft.baseUrl, token);
    const { user, workspaces } = await client.validate();
    draft.client = client; draft.token = token; draft.user = user; draft.workspaces = workspaces;
    const preferredWorkspace = draft.workspaceSlug;
    draft.workspaceSlug = workspaces.some(item => item.slug === preferredWorkspace) ? preferredWorkspace : workspaces[0]?.slug ?? "";
    await loadProjects(draft.projectId, draft.workItemId);
  } catch {
    draft.client = undefined; draft.user = undefined; draft.workspaces = []; draft.projects = []; draft.workItems = [];
    errorKey = "connectionError";
  } finally { busyKey = undefined; render(); }
}
async function changeWorkspace(): Promise<void> {
  captureForm();
  if (!draft.client) return;
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try { await loadProjects(); } catch { errorKey = "discoveryError"; draft.projects = []; draft.workItems = []; }
  finally { busyKey = undefined; render(); }
}
async function changeProject(): Promise<void> {
  captureForm();
  if (!draft.client) return;
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try { await loadWorkItems(); } catch { errorKey = "discoveryError"; draft.workItems = []; }
  finally { busyKey = undefined; render(); }
}
async function bindSequence(): Promise<void> {
  if (!sequence) return;
  captureForm();
  errorKey = undefined; noticeKey = undefined; busyKey = "bindingSequence"; render();
  try {
    const token = await tokenForDraft();
    if (!token || !draft.client || !draft.user || !draft.workspaceSlug || !draft.projectId || !draft.workItemId) throw new Error();
    const workItem = await draft.client.getWorkItem(draft.workspaceSlug, draft.projectId, draft.workItemId);
    const binding: SequenceBinding = { projectGuid: sequence.projectGuid, sequenceId: sequence.id, baseUrl: draft.baseUrl, workspaceSlug: draft.workspaceSlug, projectId: draft.projectId, workItemId: draft.workItemId };
    await store.saveToken(binding.baseUrl, token);
    store.save(binding);
    bound = { binding, user: draft.user, workItem };
    draft = emptyDraft();
  } catch { errorKey = "bindingError"; }
  finally { busyKey = undefined; render(); }
}
async function restoreBinding(binding: SequenceBinding): Promise<void> {
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try {
    const token = await store.getToken(binding.baseUrl);
    if (!token) { draft = emptyDraft(binding); errorKey = "missingCredential"; return; }
    const client = new PlaneClient(binding.baseUrl, token);
    const [user, workItem] = await Promise.all([client.getCurrentUser(), client.getWorkItem(binding.workspaceSlug, binding.projectId, binding.workItemId)]);
    bound = { binding, user, workItem };
  } catch { bound = undefined; draft = emptyDraft(binding); errorKey = "restoreError"; }
  finally { busyKey = undefined; render(); }
}
async function refreshBound(): Promise<void> {
  if (!bound) return;
  await restoreBinding(bound.binding);
}
function disconnectLocal(): void {
  if (!bound) return;
  const binding = bound.binding;
  store.disconnect(binding.projectGuid, binding.sequenceId);
  bound = undefined; draft = emptyDraft(binding); errorKey = undefined; noticeKey = "localDisconnected"; busyKey = undefined; render();
}
async function start(): Promise<void> {
  errorKey = undefined; noticeKey = undefined; busyKey = "loading"; render();
  try {
    context = await premiere.context();
    sequence = context.status === "ready" ? context.sequence : undefined;
    if (!sequence) return;
    const binding = store.get(sequence.projectGuid, sequence.id);
    if (binding) await restoreBinding(binding); else { draft = emptyDraft(); bound = undefined; }
  } catch { context = { status: "no-project" }; sequence = undefined; errorKey = "hostError"; }
  finally { busyKey = undefined; render(); }
}

root.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const action = target.dataset.action;
  if (!action || busyKey) return;
  if (action === "validate") void validateConnection();
  if (action === "bind") void bindSequence();
  if (action === "refresh") void refreshBound();
  if (action === "disconnect") disconnectLocal();
});
root.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (busyKey) return;
  if (target.id === "workspace") void changeWorkspace();
  if (target.id === "project") void changeProject();
  if (target.id === "workItem") draft.workItemId = target.value;
});

void start();
