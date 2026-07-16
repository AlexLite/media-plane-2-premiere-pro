export type ShellView = "review" | "media" | "diagnostics";

export const SHELL_VIEW_EVENT = "plane-freeframe:shell-view";

export function normalizeShellView(value: unknown): ShellView {
  return value === "media" || value === "diagnostics" ? value : "review";
}

export function requestShellView(view: ShellView): void {
  window.dispatchEvent(new CustomEvent<ShellView>(SHELL_VIEW_EVENT, { detail: view }));
}
