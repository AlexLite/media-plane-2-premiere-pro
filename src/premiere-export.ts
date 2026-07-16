import { mediaMimeType, UxpMediaFiles, type SelectedMediaFile } from "./uxp-media";

declare const require: (name: string) => any;

interface UxpFileEntry {
  isFile?: boolean;
  name: string;
  nativePath: string;
  getMetadata(): Promise<{ size: number; isFile?: boolean }>;
  read(options: { format: unknown }): Promise<string | ArrayBuffer>;
}

export interface PreparedDirectExport {
  readonly projectGuid: string;
  readonly sequenceId: string;
  readonly presetName: string;
  readonly outputName: string;
  readonly outputPath: string;
  readonly extension: string;
  readonly _preset: UxpFileEntry;
  readonly _output: UxpFileEntry;
}
export interface DirectExportOptions {
  signal?: AbortSignal;
  maxOutputChecks?: number;
  outputCheckDelayMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(): DOMException { return new DOMException("Premiere export cancelled", "AbortError"); }
function safeName(value: string): string { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "premiere-export"; }
function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

/**
 * Official Premiere UXP 25.6 export boundary.
 * EncoderManager documents render events but not the subscription/cancel mechanism.
 * Until host smoke testing confirms that mechanism, cancellation stops local waiting/upload only;
 * it does not claim to cancel a render already accepted by Premiere/AME.
 */
export class PremiereDirectExporter {
  private readonly media: UxpMediaFiles;
  constructor(
    private readonly premiereRuntime: () => any = () => require("premierepro"),
    private readonly uxpRuntime: () => any = () => require("uxp"),
  ) { this.media = new UxpMediaFiles(uxpRuntime); }

  supports(): boolean {
    const api = this.premiereRuntime();
    return typeof api.EncoderManager?.getManager === "function"
      && typeof api.EncoderManager?.getExportFileExtension === "function"
      && api.Constants?.ExportType?.IMMEDIATELY !== undefined;
  }

  private async sequence(expectedProjectGuid: string, expectedSequenceId: string): Promise<any> {
    const api = this.premiereRuntime();
    const project = await api.Project.getActiveProject();
    if (!project || String(project.guid?.toString?.() ?? "") !== expectedProjectGuid) throw new Error("The active Premiere project changed before export");
    const sequence = await project.getActiveSequence();
    const sequenceId = String(sequence?.guid?.toString?.() ?? sequence?.sequenceID ?? "");
    if (!sequence || sequenceId !== expectedSequenceId) throw new Error("The active Premiere sequence changed before export");
    return sequence;
  }

  private storage(): any {
    const localFileSystem = this.uxpRuntime().storage?.localFileSystem;
    if (!localFileSystem) throw new Error("UXP local file access is unavailable");
    return localFileSystem;
  }

  async prepare(projectGuid: string, sequenceId: string, sequenceName: string): Promise<PreparedDirectExport | undefined> {
    if (!this.supports()) throw new Error("Direct Premiere export is unavailable in this host");
    const sequence = await this.sequence(projectGuid, sequenceId);
    const fs = this.storage();
    const preset = await fs.getFileForOpening({ allowMultiple: false, types: ["epr"] }) as UxpFileEntry | null;
    if (!preset) return undefined;
    const api = this.premiereRuntime();
    const extensionValue = await api.EncoderManager.getExportFileExtension(sequence, preset.nativePath);
    const extension = String(extensionValue ?? "").replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(extension)) throw new Error("Premiere returned an invalid export file extension");
    mediaMimeType(`export.${extension}`);
    const output = await fs.getFileForSaving(`${safeName(sequenceName)}.${extension}`, { types: [extension] }) as UxpFileEntry | null;
    if (!output) return undefined;
    mediaMimeType(output.name);
    return { projectGuid, sequenceId, presetName: preset.name, outputName: output.name, outputPath: output.nativePath, extension, _preset: preset, _output: output };
  }

  async export(prepared: PreparedDirectExport, options: DirectExportOptions = {}): Promise<SelectedMediaFile> {
    if (options.signal?.aborted) throw abortError();
    const api = this.premiereRuntime();
    const sequence = await this.sequence(prepared.projectGuid, prepared.sequenceId);
    const manager = api.EncoderManager.getManager();
    if (!manager || manager.isAMEInstalled === false || typeof manager.exportSequence !== "function") throw new Error("Adobe Media Encoder is unavailable");
    const accepted = await manager.exportSequence(
      sequence,
      api.Constants.ExportType.IMMEDIATELY,
      prepared._output.nativePath,
      prepared._preset.nativePath,
      true,
    );
    if (!accepted) throw new Error("Premiere rejected the export request");
    if (options.signal?.aborted) throw abortError();

    const maxChecks = options.maxOutputChecks ?? 120;
    const delayMs = options.outputCheckDelayMs ?? 1000;
    const wait = options.sleep ?? sleep;
    if (!Number.isInteger(maxChecks) || maxChecks < 2 || !Number.isFinite(delayMs) || delayMs < 0) throw new Error("Invalid export wait configuration");
    let previousSize = -1;
    let stableChecks = 0;
    for (let check = 0; check < maxChecks; check++) {
      if (options.signal?.aborted) throw abortError();
      const metadata = await prepared._output.getMetadata();
      const size = Number(metadata.size);
      if (Number.isFinite(size) && size > 0) {
        stableChecks = size === previousSize ? stableChecks + 1 : 0;
        previousSize = size;
        if (stableChecks >= 1) return this.media.read(prepared._output, "exported", options.signal);
      }
      await wait(delayMs, options.signal);
    }
    throw new Error("Premiere export output did not become ready in time");
  }
}
