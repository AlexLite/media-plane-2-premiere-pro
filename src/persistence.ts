import type { SequenceBinding } from "./domain";
const BINDINGS_KEY = "plane-sequence-bindings-v1";
const TOKEN_PREFIX = "plane-token:";
declare const require: (name: string) => { storage?: { secureStorage?: { getItem(key: string): Promise<ArrayBuffer | undefined>; setItem(key: string, value: ArrayBuffer): Promise<void> } }; localStorage?: Storage };
const encoder = new TextEncoder(), decoder = new TextDecoder();
function uxp() { return require("uxp"); }
export class BindingStore {
  private storage(): Storage { return uxp().localStorage ?? window.localStorage; }
  get(sequenceId: string): SequenceBinding | undefined { return this.all()[sequenceId]; }
  save(binding: SequenceBinding) { const values = this.all(); values[binding.sequenceId] = binding; this.storage().setItem(BINDINGS_KEY, JSON.stringify(values)); }
  private all(): Record<string, SequenceBinding> { try { return JSON.parse(this.storage().getItem(BINDINGS_KEY) ?? "{}"); } catch { return {}; } }
  async saveToken(baseUrl: string, token: string) { const secure = uxp().storage?.secureStorage; if (!secure) throw new Error("UXP secure storage is unavailable in this host."); await secure.setItem(TOKEN_PREFIX + baseUrl, encoder.encode(token).buffer); }
  async getToken(baseUrl: string) { const value = await uxp().storage?.secureStorage?.getItem(TOKEN_PREFIX + baseUrl); return value ? decoder.decode(value) : undefined; }
}
