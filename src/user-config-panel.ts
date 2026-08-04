import { ct } from "./config-locale";
import { DirectFreeFrameClient, type DirectUser } from "./direct-freeframe-client";
import { normalizeFreeFrameApiUrl } from "./freeframe-client";
import { INTERFACE_LOCALE_EVENT } from "./locale-preference";
import { BindingStore, DirectFreeFrameStore } from "./persistence";
import { PlaneClient } from "./plane-client";
import { SHELL_VIEW_EVENT, USER_CONFIG_EVENT } from "./shell-events";

const root = document.querySelector<HTMLDivElement>("#user-config-app");
const planeStore = new BindingStore();
const freeFrameStore = new DirectFreeFrameStore();
let planeUrl = planeStore.getPlaneUrl();
let freeFrameUrl = freeFrameStore.getUrl();
let planeIdentity = "";
let freeFrameUser: DirectUser | undefined;
let freeFrameClient: DirectFreeFrameClient | undefined;
let busy: "plane" | "freeframe" | "" = "";
let planeMessage: "saved" | "error" | "" = "";
let freeFrameMessage: "saved" | "error" | "" = "";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const status = (connected: boolean, identity = "") => `<div class="config-status"><span class="config-status-dot ${connected ? "connected" : ""}"></span><span>${escape(connected ? ct("connected") : ct("notConnected"))}${identity ? ` · ${escape(identity)}` : ""}</span></div>`;
const message = (kind: "saved" | "error" | "", service: "plane" | "freeframe") => kind ? `<p class="config-message ${kind === "error" ? "error" : "notice"}">${escape(kind === "saved" ? ct("saved") : ct(service === "plane" ? "planeError" : "freeframeError"))}</p>` : "";

function createFreeFrameClient(url: string): DirectFreeFrameClient {
  return new DirectFreeFrameClient(url, {
    getRefreshToken: () => freeFrameStore.getRefreshToken(url),
    onTokens: tokens => freeFrameStore.saveRefreshToken(url, tokens.refresh_token),
    onSessionExpired: async () => { await freeFrameStore.clearRefreshToken(url); freeFrameUser = undefined; },
  });
}

function render(): void {
  if (!root) return;
  root.innerHTML = `<div class="config-page"><div class="config-heading"><h2>${escape(ct("title"))}</h2><p>${escape(ct("intro"))}</p></div><div class="config-security">${escape(ct("security"))}</div><section class="config-card"><div class="config-card-head"><div><h3>${escape(ct("planeTitle"))}</h3><p>${escape(ct("planeIntro"))}</p></div>${status(Boolean(planeIdentity), planeIdentity)}</div><div class="config-fields"><label for="configPlaneUrl">${escape(ct("planeUrl"))}</label><input class="uxp-input" id="configPlaneUrl" type="text" value="${escape(planeUrl)}" placeholder="https://plane.example.com" autocomplete="off"/><p class="field-hint">${escape(ct("httpsHint"))}</p><label for="configPlaneToken">${escape(ct("planeToken"))}</label><input class="uxp-input" id="configPlaneToken" type="password" placeholder="${escape(ct("tokenPlaceholder"))}" autocomplete="off"/><button class="config-primary" data-config-action="plane-save"${busy ? " disabled" : ""}>${escape(busy === "plane" ? ct("checking") : ct("validateSave"))}</button>${message(planeMessage, "plane")}</div></section><section class="config-card"><div class="config-card-head"><div><h3>${escape(ct("freeframeTitle"))}</h3><p>${escape(ct("freeframeIntro"))}</p></div>${status(Boolean(freeFrameUser), freeFrameUser?.email)}</div><div class="config-fields"><label for="configFreeFrameUrl">${escape(ct("freeframeUrl"))}</label><input class="uxp-input" id="configFreeFrameUrl" type="text" value="${escape(freeFrameUrl)}" placeholder="https://freeframe.example.com" autocomplete="off"/><p class="field-hint">${escape(ct("httpsHint"))}</p>${freeFrameUser ? `<button class="config-secondary" data-config-action="freeframe-logout"${busy ? " disabled" : ""}>${escape(ct("signOut"))}</button>` : `<label for="configFreeFrameEmail">${escape(ct("email"))}</label><input class="uxp-input" id="configFreeFrameEmail" type="text" autocomplete="off" placeholder="you@example.com"/><label for="configFreeFramePassword">${escape(ct("password"))}</label><input class="uxp-input" id="configFreeFramePassword" type="password" autocomplete="off"/><button class="config-primary" data-config-action="freeframe-login"${busy ? " disabled" : ""}>${escape(busy === "freeframe" ? ct("checking") : ct("signIn"))}</button>`}${message(freeFrameMessage, "freeframe")}</div></section></div>`;
}

async function restore(): Promise<void> {
  try {
    if (planeUrl) { const token = await planeStore.getToken(planeUrl); if (token) { const user = await new PlaneClient(planeUrl, token).getCurrentUser(); planeIdentity = user.email; } }
  } catch { planeIdentity = ""; }
  try {
    if (freeFrameUrl) { const refresh = await freeFrameStore.getRefreshToken(freeFrameUrl); if (refresh) { freeFrameClient = createFreeFrameClient(freeFrameUrl); const tokens = await freeFrameClient.refresh(refresh); await freeFrameStore.saveRefreshToken(freeFrameUrl, tokens.refresh_token); freeFrameUser = await freeFrameClient.me(); } }
  } catch { freeFrameClient = undefined; freeFrameUser = undefined; }
  render();
}

async function savePlane(): Promise<void> {
  const url = root?.querySelector<HTMLInputElement>("#configPlaneUrl")?.value.trim() ?? "";
  const entered = root?.querySelector<HTMLInputElement>("#configPlaneToken")?.value ?? "";
  planeUrl = url;
  busy = "plane"; planeMessage = ""; render();
  try {
    const token = entered || await planeStore.getToken(url);
    if (!token) throw new Error();
    const client = new PlaneClient(url, token);
    const { user } = await client.validate();
    planeUrl = url;
    planeIdentity = user.email;
    planeStore.savePlaneUrl(url);
    await planeStore.saveToken(url, token);
    planeMessage = "saved";
    window.dispatchEvent(new CustomEvent(USER_CONFIG_EVENT, { detail: "plane" }));
  } catch { planeIdentity = ""; planeMessage = "error"; }
  finally { busy = ""; render(); }
}

async function loginFreeFrame(): Promise<void> {
  const url = root?.querySelector<HTMLInputElement>("#configFreeFrameUrl")?.value.trim() ?? "";
  const email = root?.querySelector<HTMLInputElement>("#configFreeFrameEmail")?.value.trim() ?? "";
  const password = root?.querySelector<HTMLInputElement>("#configFreeFramePassword")?.value ?? "";
  freeFrameUrl = url; busy = "freeframe"; freeFrameMessage = ""; render();
  try {
    const normalized = normalizeFreeFrameApiUrl(url);
    const next = createFreeFrameClient(normalized);
    const tokens = await next.login(email, password);
    freeFrameUser = await next.me(); freeFrameClient = next; freeFrameUrl = normalized;
    freeFrameStore.saveUrl(normalized); await freeFrameStore.saveRefreshToken(normalized, tokens.refresh_token);
    freeFrameMessage = "saved";
    window.dispatchEvent(new CustomEvent(USER_CONFIG_EVENT, { detail: "freeframe" }));
  } catch { freeFrameUser = undefined; freeFrameClient = undefined; freeFrameMessage = "error"; }
  finally { busy = ""; render(); }
}

async function logoutFreeFrame(): Promise<void> {
  if (freeFrameUrl) await freeFrameStore.clearRefreshToken(freeFrameUrl);
  freeFrameClient?.clearSession(); freeFrameClient = undefined; freeFrameUser = undefined; freeFrameMessage = "";
  window.dispatchEvent(new CustomEvent(USER_CONFIG_EVENT, { detail: "freeframe" })); render();
}

root?.addEventListener("click", event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-config-action]")?.dataset.configAction;
  if (action === "plane-save") void savePlane();
  if (action === "freeframe-login") void loginFreeFrame();
  if (action === "freeframe-logout") void logoutFreeFrame();
});
window.addEventListener(INTERFACE_LOCALE_EVENT, render);
window.addEventListener(SHELL_VIEW_EVENT, event => { if ((event as CustomEvent<unknown>).detail === "settings") void restore(); });
render();
