import { ACTIVE_CONTEXT_EVENT, activeContextKey } from "./active-context";
import { FREEFRAME_AUTH_EVENT, normalizeShellMode, normalizeShellView, SHELL_MODE_EVENT, SHELL_VIEW_EVENT, type ShellMode, type ShellView } from "./shell-events";
import { interfaceLocale, INTERFACE_LOCALE_EVENT, setInterfaceLocale, type InterfaceLocale } from "./locale-preference";
import { PremiereAdapter } from "./premiere";
import { st } from "./shell-locale";

const root = document.querySelector<HTMLDivElement>("#shell-app");
const VIEW_STORAGE_KEY = "plane-freeframe-active-view-v1";
const MODE_STORAGE_KEY = "plane-freeframe-active-mode-v1";
const views: ShellView[] = ["review", "media", "diagnostics", "settings"];
const premiere = new PremiereAdapter();
let active: ShellView = normalizeShellView(window.localStorage.getItem(VIEW_STORAGE_KEY));
let mode: ShellMode = normalizeShellMode(window.localStorage.getItem(MODE_STORAGE_KEY));
let observedContextKey: string | undefined;
let contextScanRunning = false;
let forceScanPending = false;
let freeFrameAuthenticated = false;

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function label(view: ShellView): string {
  return st(({ review: "navReview", media: "navMedia", diagnostics: "navDiagnostics", settings: "navSettings" } as const)[view]);
}

function tabContent(view: ShellView): string {
  if (view !== "settings") return escape(label(view));
  return `<img class="shell-user-icon" src="assets/user.png" alt="" aria-hidden="true">`;
}

function tabMarkup(view: ShellView): string {
  const attributes = `class="shell-tab${view === "settings" ? " shell-tab-user" : ""}" role="tab" data-shell-tab="${view}" aria-selected="false" aria-label="${escape(label(view))}" title="${escape(label(view))}"`;
  return view === "settings" ? `<div ${attributes} tabindex="-1">${tabContent(view)}</div>` : `<button ${attributes}>${tabContent(view)}</button>`;
}

function freeFrameHeader(): string {
  const locale = interfaceLocale();
  const navigation = freeFrameAuthenticated ? `<nav class="ff-primary-tabs" role="tablist"><div class="ff-primary-tab" role="tab" tabindex="0" data-shell-tab="review">⌘ ${escape(st("freeframeSequences"))}</div><div class="ff-primary-tab" role="tab" tabindex="0" data-shell-tab="media">▦ ${escape(st("freeframeBrowse"))}</div></nav>` : "";
  return `<header class="ff-shell-header"><div class="ff-appbar"><div class="ff-app-title"><strong>${escape(st("freeframeTitle"))}</strong><span aria-hidden="true">☰</span></div><div class="ff-app-actions"><label class="ff-locale-control" for="interfaceLocale"><span>${escape(st("languageLabel"))}</span><select id="interfaceLocale"><option value="ru"${locale === "ru" ? " selected" : ""}>${escape(st("languageRussian"))}</option><option value="en"${locale === "en" ? " selected" : ""}>${escape(st("languageEnglish"))}</option></select></label><div class="ff-account" role="button" tabindex="0" data-shell-tab="settings" aria-label="${escape(st("freeframeAccount"))}" title="${escape(st("freeframeAccount"))}"><img class="shell-user-icon" src="assets/user.png" alt=""></div></div></div>${navigation}</header>`;
}

function apply(view: ShellView): void {
  active = normalizeShellView(view);
  window.localStorage.setItem(VIEW_STORAGE_KEY, active);
  document.body.dataset.activeView = active;
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-shell-view]"))) node.hidden = node.dataset.shellView !== active;
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-shell-mode-content]"))) node.hidden = active === "settings" || node.dataset.shellModeContent !== mode;
  for (const tab of Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-shell-tab]") ?? [])) {
    const selected = tab.dataset.shellTab === active;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  window.dispatchEvent(new CustomEvent<ShellView>(SHELL_VIEW_EVENT, { detail: active }));
}

function applyMode(value: ShellMode): void {
  mode = normalizeShellMode(value);
  window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  document.body.dataset.activeMode = mode;
  render();
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-shell-mode-content]"))) node.hidden = active === "settings" || node.dataset.shellModeContent !== mode;
  for (const tab of Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-shell-mode-tab]") ?? [])) {
    const selected = tab.dataset.shellModeTab === mode;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  apply(active);
  window.dispatchEvent(new CustomEvent<ShellMode>(SHELL_MODE_EVENT, { detail: mode }));
}

function render(): void {
  if (!root) return;
  if (mode === "freeframe") {
    root.innerHTML = freeFrameHeader();
    apply(active);
    return;
  }
  const locale = interfaceLocale();
  root.innerHTML = `<header class="app-shell-header"><div class="app-shell-top"><div class="app-shell-brand"><h1>${escape(st("shellTitle"))}</h1><p>${escape(st("shellSubtitle"))}</p></div><div class="shell-utilities"><button class="secondary context-refresh" data-context-refresh>${escape(st("refreshSequence"))}</button><label class="locale-control" for="interfaceLocale"><span>${escape(st("languageLabel"))}</span><select id="interfaceLocale"><option value="ru"${locale === "ru" ? " selected" : ""}>${escape(st("languageRussian"))}</option><option value="en"${locale === "en" ? " selected" : ""}>${escape(st("languageEnglish"))}</option></select></label></div></div><div class="mode-tabs" role="tablist"><button class="mode-tab" data-shell-mode-tab="plane">${escape(st("modePlane"))}</button><button class="mode-tab" data-shell-mode-tab="freeframe">${escape(st("modeFreeFrame"))}</button></div><nav class="shell-tabs" role="tablist">${views.map(tabMarkup).join("")}</nav></header>`;
  apply(active);
}

async function scanActiveContext(force = false): Promise<void> {
  if (contextScanRunning) { forceScanPending ||= force; return; }
  contextScanRunning = true;
  try {
    const next = activeContextKey(await premiere.context());
    const changed = observedContextKey !== undefined && next !== observedContextKey;
    observedContextKey = next;
    if (force || changed) window.dispatchEvent(new CustomEvent(ACTIVE_CONTEXT_EVENT, { detail: force ? "manual" : "changed" }));
  } catch {
    // A transient host transition is retried by the next scan.
  } finally {
    contextScanRunning = false;
    if (forceScanPending) { forceScanPending = false; void scanActiveContext(true); }
  }
}

root?.addEventListener("click", event => {
  const modeTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-shell-mode-tab]");
  if (modeTarget) applyMode(normalizeShellMode(modeTarget.dataset.shellModeTab));
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-shell-tab]");
  if (target) apply(normalizeShellView(target.dataset.shellTab));
  if ((event.target as HTMLElement).closest<HTMLElement>("[data-context-refresh]")) void scanActiveContext(true);
});
root?.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "interfaceLocale" && (target.value === "ru" || target.value === "en")) setInterfaceLocale(target.value as InterfaceLocale);
});
root?.addEventListener("keydown", event => {
  if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const index = views.indexOf(active);
  const delta = event.key === "ArrowRight" ? 1 : -1;
  apply(views[(index + delta + views.length) % views.length]);
  root.querySelector<HTMLButtonElement>(`[data-shell-tab="${active}"]`)?.focus();
});

window.addEventListener(SHELL_VIEW_EVENT, event => {
  const requested = normalizeShellView((event as CustomEvent<unknown>).detail);
  if (requested !== active) apply(requested);
});
window.addEventListener(INTERFACE_LOCALE_EVENT, render);
window.addEventListener(FREEFRAME_AUTH_EVENT, event => {
  const authenticated = Boolean((event as CustomEvent<unknown>).detail);
  if (authenticated === freeFrameAuthenticated) return;
  freeFrameAuthenticated = authenticated;
  if (mode === "freeframe") render();
});

render();
void scanActiveContext();
const contextScanTimer = window.setInterval(() => void scanActiveContext(), 3000);
window.addEventListener("unload", () => window.clearInterval(contextScanTimer));
