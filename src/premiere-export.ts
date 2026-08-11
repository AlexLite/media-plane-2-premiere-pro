import type { UxpFileEntry } from "./uxp-media";

export interface PreparedDirectExport {
  readonly projectGuid: string;
  readonly sequenceId: string;
  readonly presetName: string;
  readonly presetPath: string;
  readonly outputName: string;
  readonly outputPath: string;
  readonly extension: string;
  readonly sequence: any;
  readonly outputEntry: UxpFileEntry;
}

export interface DirectExportOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
}

type PremiereRuntime = () => any;

function abortError(): DOMException { return new DOMException("Export cancelled", "AbortError"); }

/**
 * Direct sequence export through the documented Premiere UXP 25.6
 * EncoderManager boundary. The caller owns the file picker and upload; this
 * class only submits the render and waits for the authoritative AME event.
 */
export class PremiereDirectExporter {
  constructor(private readonly runtime: PremiereRuntime = () => require("premierepro")) {}

  private api(): any { return this.runtime(); }

  supports(): boolean {
    try {
      const api = this.api();
      return Boolean(
        api.EncoderManager?.getManager &&
        api.EncoderManager?.getExportFileExtension &&
        api.EventManager?.addEventListener &&
        (api.Constants?.ExportType?.IMMEDIATELY ?? api.EncoderManager?.EXPORT_IMMEDIATELY),
      );
    } catch { return false; }
  }

  async outputExtension(sequence: any, presetPath: string): Promise<string> {
    if (!this.supports()) throw new Error("Direct Premiere export is unavailable in this Premiere version");
    const extension = String(await this.api().EncoderManager.getExportFileExtension(sequence, presetPath) ?? "").replace(/^\./, "").toLowerCase();
    if (!extension || !/^[a-z0-9]+$/.test(extension)) throw new Error("Premiere returned an invalid export extension");
    return extension;
  }

  async prepare(projectGuid: string, sequenceId: string, sequenceName: string): Promise<undefined>;
  async prepare(
    projectGuid: string,
    sequenceId: string,
    sequence: any,
    sequenceName: string,
    preset: UxpFileEntry,
    output: UxpFileEntry,
  ): Promise<PreparedDirectExport>;
  async prepare(
    projectGuid: string,
    sequenceId: string,
    sequenceOrName: any,
    sequenceName?: string,
    preset?: UxpFileEntry,
    output?: UxpFileEntry,
  ): Promise<PreparedDirectExport | undefined> {
    if (typeof sequenceOrName === "string" || !preset || !output) return undefined;
    const sequence = sequenceOrName;
    if (!this.supports()) throw new Error("Direct Premiere export is unavailable in this Premiere version");
    if (!sequence || !projectGuid || !sequenceId || !sequenceName) throw new Error("No active Premiere sequence");
    if (!preset?.isFile || !preset.nativePath || !preset.name.toLowerCase().endsWith(".epr")) throw new Error("Choose a valid .epr Premiere preset");
    if (!output?.isFile || !output.nativePath) throw new Error("Choose a valid export destination");
    const extension = await this.outputExtension(sequence, preset.nativePath);
    return { projectGuid, sequenceId, sequence, presetName: preset.name, presetPath: preset.nativePath, outputName: output.name || `${sequenceName}.${extension}`, outputPath: output.nativePath, extension, outputEntry: output };
  }

  async export(prepared: PreparedDirectExport, options: DirectExportOptions = {}): Promise<UxpFileEntry> {
    if (!this.supports()) throw new Error("Direct Premiere export is unavailable in this Premiere version");
    if (options.signal?.aborted) throw abortError();
    const api = this.api();
    const encoder = await api.EncoderManager.getManager();
    if (encoder.isAMEInstalled === false) throw new Error("Adobe Media Encoder is not installed or compatible");
    const eventManager = api.EventManager;
    const completeEvent = api.EncoderManager.EVENT_RENDER_COMPLETE;
    const errorEvent = api.EncoderManager.EVENT_RENDER_ERROR;
    const cancelEvent = api.EncoderManager.EVENT_RENDER_CANCEL;
    const progressEvent = api.EncoderManager.EVENT_RENDER_PROGRESS;
    if (!completeEvent || !errorEvent || !cancelEvent) throw new Error("Premiere render events are unavailable");
    const exportType = api.Constants?.ExportType?.IMMEDIATELY ?? api.EncoderManager.EXPORT_IMMEDIATELY;

    return await new Promise<UxpFileEntry>((resolve, reject) => {
      let settled = false;
      const remove = (eventName: string | undefined, handler: (event?: object) => void) => {
        if (!eventName) return;
        try { eventManager.removeEventListener(encoder, eventName, handler); } catch { /* host may not expose removal during shutdown */ }
      };
      const finish = (callback: () => void) => { if (settled) return; settled = true; remove(completeEvent, onComplete); remove(errorEvent, onError); remove(cancelEvent, onCancel); remove(progressEvent, onProgress); options.signal?.removeEventListener("abort", abort); callback(); };
      const stableOutput = async () => {
        let previous = 0;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (options.signal?.aborted) throw abortError();
          const metadata = await prepared.outputEntry.getMetadata();
          const size = Number(metadata?.size ?? 0);
          if (size > 0 && size === previous) return;
          previous = size;
          await new Promise<void>(wait => setTimeout(wait, 250));
        }
        throw new Error("Premiere completed without a stable exported file");
      };
      const onComplete = () => { void stableOutput().then(() => finish(() => resolve(prepared.outputEntry))).catch(error => finish(() => reject(error))); };
      const onError = () => finish(() => reject(new Error("Premiere/AME export failed")));
      const onCancel = () => finish(() => reject(new Error("Premiere/AME export was cancelled")));
      const onProgress = (event?: object) => {
        const value = Number((event as { progress?: number; percent?: number } | undefined)?.progress ?? (event as { percent?: number } | undefined)?.percent);
        if (Number.isFinite(value)) options.onProgress?.(value > 1 ? value / 100 : value);
      };
      const abort = () => finish(() => reject(abortError()));
      try {
        eventManager.addEventListener(encoder, completeEvent, onComplete);
        eventManager.addEventListener(encoder, errorEvent, onError);
        eventManager.addEventListener(encoder, cancelEvent, onCancel);
        if (progressEvent) eventManager.addEventListener(encoder, progressEvent, onProgress);
        options.signal?.addEventListener("abort", abort, { once: true });
        void encoder.exportSequence(prepared.sequence, exportType, prepared.outputPath, prepared.presetPath, true).then((accepted: boolean) => {
          if (!accepted) finish(() => reject(new Error("Premiere rejected the export request")));
        }).catch((error: unknown) => finish(() => reject(error)));
      } catch (error) { finish(() => reject(error)); }
    });
  }
}
