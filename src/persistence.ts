import type { SequenceBinding } from "./domain";
const BINDINGS_KEY = "plane-freeframe-sequence-bindings-v2";
const TOKEN_PREFIX = "plane-token:";
const PLANE_URL_KEY = "plane-user-config-url-v1";
const DIRECT_URL_KEY = "freeframe-direct-url-v1";
const DIRECT_REFRESH_PREFIX = "freeframe-refresh:";
const DIRECT_SEQUENCE_BINDINGS_KEY = "freeframe-direct-sequence-bindings-v1";

export interface DirectSequenceBinding {
  serverUrl: string;
  projectGuid: string;
  sequenceId: string;
  projectId: string;
  assetId: string;
}

interface SecureStorage {
  getItem(key: string): Promise<ArrayBuffer | undefined>;
  setItem(key: string, value: ArrayBuffer): Promise<void>;
  removeItem?(key: string): Promise<void>;
}
export interface UxpStorageBoundary { localStorage?: Storage; storage?: { secureStorage?: SecureStorage } }
declare const require: (name: string) => UxpStorageBoundary;

function encodeUtf8(value: string): ArrayBuffer {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return Uint8Array.from(bytes).buffer;
}

function decodeUtf8(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let decoded = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint: number;
    if (first < 0x80) codePoint = first;
    else if (first < 0xe0) codePoint = ((first & 0x1f) << 6) | (bytes[index++] & 0x3f);
    else if (first < 0xf0) codePoint = ((first & 0x0f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f);
    else codePoint = ((first & 0x07) << 18) | ((bytes[index++] & 0x3f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f);
    decoded += String.fromCodePoint(codePoint);
  }
  return decoded;
}

function defaultUxp(): UxpStorageBoundary { return require("uxp"); }
export function bindingKey(projectGuid: string, sequenceId: string): string { return `${projectGuid}:${sequenceId}`; }
export class BindingStore {
  constructor(private readonly runtime: () => UxpStorageBoundary = defaultUxp) {}
  private storage(): Storage { return this.runtime().localStorage ?? window.localStorage; }
  get(projectGuid: string, sequenceId: string): SequenceBinding | undefined { return this.all()[bindingKey(projectGuid, sequenceId)]; }
  save(binding: SequenceBinding): void { const values = this.all(); values[bindingKey(binding.projectGuid, binding.sequenceId)] = binding; this.storage().setItem(BINDINGS_KEY, JSON.stringify(values)); }
  disconnect(projectGuid: string, sequenceId: string): void { const values = this.all(); delete values[bindingKey(projectGuid, sequenceId)]; this.storage().setItem(BINDINGS_KEY, JSON.stringify(values)); }
  private all(): Record<string, SequenceBinding> { try { return JSON.parse(this.storage().getItem(BINDINGS_KEY) ?? "{}"); } catch { return {}; } }
  async saveToken(baseUrl: string, token: string): Promise<void> { const secure = this.runtime().storage?.secureStorage; if (!secure) throw new Error("UXP secure storage is unavailable"); await secure.setItem(TOKEN_PREFIX + baseUrl, encodeUtf8(token)); }
  async getToken(baseUrl: string): Promise<string | undefined> { const value = await this.runtime().storage?.secureStorage?.getItem(TOKEN_PREFIX + baseUrl); return value ? decodeUtf8(value) : undefined; }
  getPlaneUrl(): string { return this.storage().getItem(PLANE_URL_KEY) ?? ""; }
  savePlaneUrl(baseUrl: string): void { this.storage().setItem(PLANE_URL_KEY, baseUrl); }
  async clearToken(baseUrl: string): Promise<void> { await this.runtime().storage?.secureStorage?.removeItem?.(TOKEN_PREFIX + baseUrl); }
}

export class DirectFreeFrameStore {
  constructor(private readonly runtime: () => UxpStorageBoundary = defaultUxp) {}
  private storage(): Storage { return this.runtime().localStorage ?? window.localStorage; }
  getUrl(): string { return this.storage().getItem(DIRECT_URL_KEY) ?? ""; }
  saveUrl(url: string): void { this.storage().setItem(DIRECT_URL_KEY, url); }
  getSequenceBinding(serverUrl: string, projectGuid: string, sequenceId: string): DirectSequenceBinding | undefined {
    return this.sequenceBindings()[`${serverUrl}:${bindingKey(projectGuid, sequenceId)}`];
  }
  saveSequenceBinding(binding: DirectSequenceBinding): void {
    const bindings = this.sequenceBindings();
    bindings[`${binding.serverUrl}:${bindingKey(binding.projectGuid, binding.sequenceId)}`] = binding;
    this.storage().setItem(DIRECT_SEQUENCE_BINDINGS_KEY, JSON.stringify(bindings));
  }
  clearSequenceBinding(serverUrl: string, projectGuid: string, sequenceId: string): void {
    const bindings = this.sequenceBindings();
    delete bindings[`${serverUrl}:${bindingKey(projectGuid, sequenceId)}`];
    this.storage().setItem(DIRECT_SEQUENCE_BINDINGS_KEY, JSON.stringify(bindings));
  }
  private sequenceBindings(): Record<string, DirectSequenceBinding> {
    try { return JSON.parse(this.storage().getItem(DIRECT_SEQUENCE_BINDINGS_KEY) ?? "{}"); } catch { return {}; }
  }
  async saveRefreshToken(url: string, token: string): Promise<void> {
    const secure = this.runtime().storage?.secureStorage;
    if (!secure) throw new Error("UXP secure storage is unavailable");
    await secure.setItem(DIRECT_REFRESH_PREFIX + url, encodeUtf8(token));
  }
  async getRefreshToken(url: string): Promise<string | undefined> {
    const value = await this.runtime().storage?.secureStorage?.getItem(DIRECT_REFRESH_PREFIX + url);
    return value ? decodeUtf8(value) : undefined;
  }
  async clearRefreshToken(url: string): Promise<void> {
    await this.runtime().storage?.secureStorage?.removeItem?.(DIRECT_REFRESH_PREFIX + url);
  }
}
