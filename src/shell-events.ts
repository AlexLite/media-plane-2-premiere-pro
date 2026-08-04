export type ShellView = "review" | "media" | "diagnostics" | "settings";
export type ShellMode = "plane" | "freeframe";

export const SHELL_VIEW_EVENT = "plane-freeframe:shell-view";
export const SHELL_MODE_EVENT = "plane-freeframe:shell-mode";
export const USER_CONFIG_EVENT = "plane-freeframe:user-config";

export function normalizeShellView(value: unknown): ShellView {
  return value === "media" || value === "diagnostics" || value === "settings" ? value : "review";
}

export function normalizeShellMode(value: unknown): ShellMode {
  return value === "freeframe" ? "freeframe" : "plane";
}

export function requestShellView(view: ShellView): void {
  window.dispatchEvent(new CustomEvent<ShellView>(SHELL_VIEW_EVENT, { detail: view }));
}
