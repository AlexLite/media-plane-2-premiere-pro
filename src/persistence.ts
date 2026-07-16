import type { SequenceBinding } from "./domain";
const BINDINGS_KEY = "plane-freeframe-sequence-bindings-v2";
const TOKEN_PREFIX = "plane-token:";
declare const require: (name: string) => { storage?: { secureStorage?: { getItem(key: string): Promise<ArrayBuffer | undefined>; setItem(key: string, value: ArrayBuffer): Promise<void>; removeItem?(key: string): Promise<void> } }; localStorage?: Storage };
const encoder = new TextEncoder(), decoder = new TextDecoder();
function uxp() { return require("uxp"); }
export function bindingKey(projectGuid: string, sequenceId: string): string { return `${projectGuid}:${sequenceId}`; }
export class BindingStore {
  private storage(): Storage { return uxp().localStorage ?? window.localStorage; }
  get(projectGuid: string, sequenceId: string): SequenceBinding | undefined { return this.all()[bindingKey(projectGuid, sequenceId)]; }
  save(binding: SequenceBinding): void { const values = this.all(); values[bindingKey(binding.projectGuid, binding.sequenceId)] = binding; this.storage().setItem(BINDINGS_KEY, JSON.stringify(values)); }
  disconnect(projectGuid: string, sequenceId: string): void { const values = this.all(); delete values[bindingKey(projectGuid, sequenceId)]; this.storage().setItem(BINDINGS_KEY, JSON.stringify(values)); }
  private all(): Record<string, SequenceBinding> { try { return JSON.parse(this.storage().getItem(BINDINGS_KEY) ?? "{}"); } catch { return {}; } }
  async saveToken(baseUrl: string, token: string): Promise<void> { const secure = uxp().storage?.secureStorage; if (!secure) throw new Error("UXP secure storage is unavailable"); await secure.setItem(TOKEN_PREFIX + baseUrl, encoder.encode(token).buffer); }
  async getToken(baseUrl: string): Promise<string | undefined> { const value = await uxp().storage?.secureStorage?.getItem(TOKEN_PREFIX + baseUrl); return value ? decoder.decode(value) : undefined; }
}
