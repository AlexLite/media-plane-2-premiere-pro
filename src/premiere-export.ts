import type { SelectedMediaFile } from "./uxp-media";

export interface PreparedDirectExport {
  readonly projectGuid: string;
  readonly sequenceId: string;
  readonly presetName: string;
  readonly outputName: string;
  readonly outputPath: string;
  readonly extension: string;
}
export interface DirectExportOptions { signal?: AbortSignal }

/**
 * Fail-closed boundary for Premiere/AME direct export.
 *
 * Premiere UXP 25.6 exposes export submission, but this integration does not
 * yet have a host-verified completion/error event and render cancellation
 * contract. File-size stability is not a safe completion signal. Keep direct
 * export unavailable until that contract is implemented and smoke-tested;
 * users can upload a file exported by Premiere in the meantime.
 */
export class PremiereDirectExporter {
  constructor(..._unused: unknown[]) {}
  supports(): false { return false; }
  async prepare(_projectGuid: string, _sequenceId: string, _sequenceName: string): Promise<PreparedDirectExport | undefined> {
    throw new Error("Direct Premiere export is disabled until host completion events are verified");
  }
  async export(_prepared: PreparedDirectExport, _options: DirectExportOptions = {}): Promise<SelectedMediaFile> {
    throw new Error("Direct Premiere export is disabled until host completion events are verified");
  }
}
