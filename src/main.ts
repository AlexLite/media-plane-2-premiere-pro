import { t } from "./locale";
import { PremiereAdapter } from "./premiere";

const root = document.querySelector<HTMLDivElement>("#app")!;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

async function render(): Promise<void> {
  const premiere = new PremiereAdapter();
  try {
    const sequence = await premiere.activeSequence();
    root.innerHTML = `<header><span class="badge">${escape(t("scaffold"))}</span><h1>${escape(t("title"))}</h1><p>${escape(t("architecture"))}</p></header><main><section><h2>${escape(t("sequence"))}</h2><p>${sequence ? escape(sequence.name) : escape(t("noSequence"))}</p></section><section><h2>${escape(premiere.supportsDirectExport() ? t("directExport") : t("fileFallback"))}</h2><p>${escape(t("next"))}</p></section></main>`;
  } catch (error) {
    root.innerHTML = `<p class="error">${escape(error instanceof Error ? error.message : String(error))}</p>`;
  }
}
void render();
