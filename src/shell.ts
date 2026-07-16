import { normalizeShellView, SHELL_VIEW_EVENT, type ShellView } from "./shell-events";
import { st } from "./shell-locale";

const root = document.querySelector<HTMLDivElement>("#shell-app");
const STORAGE_KEY = "plane-freeframe-active-view-v1";
const views: ShellView[] = ["review", "media", "diagnostics"];
let active: ShellView = normalizeShellView(window.localStorage.getItem(STORAGE_KEY));

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function label(view: ShellView): string {
  return st(({ review: "navReview", media: "navMedia", diagnostics: "navDiagnostics" } as const)[view]);
}

function apply(view: ShellView): void {
  active = normalizeShellView(view);
  window.localStorage.setItem(STORAGE_KEY, active);
  document.body.dataset.activeView = active;
  for (const node of document.querySelectorAll<HTMLElement>("[data-shell-view]")) {
    node.hidden = node.dataset.shellView !== active;
  }
  for (const tab of root?.querySelectorAll<HTMLButtonElement>("[data-shell-tab]") ?? []) {
    const selected = tab.dataset.shellTab === active;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  window.dispatchEvent(new CustomEvent<ShellView>(SHELL_VIEW_EVENT, { detail: active }));
}

function render(): void {
  if (!root) return;
  root.innerHTML = `<header class="app-shell-header"><div class="app-shell-brand"><h1>${escape(st("shellTitle"))}</h1><p>${escape(st("shellSubtitle"))}</p></div><nav class="shell-tabs" role="tablist">${views.map(view => `<button class="shell-tab" role="tab" data-shell-tab="${view}" aria-selected="false">${escape(label(view))}</button>`).join("")}</nav></header>`;
  root.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-shell-tab]");
    if (target) apply(normalizeShellView(target.dataset.shellTab));
  });
  root.addEventListener("keydown", event => {
    if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const index = views.indexOf(active);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    apply(views[(index + delta + views.length) % views.length]);
    root.querySelector<HTMLButtonElement>(`[data-shell-tab="${active}"]`)?.focus();
  });
  apply(active);
}

window.addEventListener(SHELL_VIEW_EVENT, event => {
  const requested = normalizeShellView((event as CustomEvent<unknown>).detail);
  if (requested !== active) apply(requested);
});

render();
