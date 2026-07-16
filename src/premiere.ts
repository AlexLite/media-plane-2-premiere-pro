import type { PremiereContext, SequenceInfo } from "./domain";
declare const require: (name: string) => any;

/** Official Premiere UXP 25.6+ boundary. Marker/export writes stay explicit TODOs until host smoke tests. */
export class PremiereAdapter {
  constructor(private readonly runtime: () => any = () => require("premierepro")) {}
  private api(): any { return this.runtime(); }
  async context(): Promise<PremiereContext> {
    const api = this.api();
    const project = await api.Project.getActiveProject();
    if (!project) return { status: "no-project" };
    const projectGuid = String(project.guid?.toString?.() ?? "");
    if (!projectGuid) throw new Error("Premiere did not expose a stable project identity");
    const sequence = await project.getActiveSequence();
    if (!sequence) return { status: "no-sequence", projectGuid };
    const sequenceId = String(sequence.guid?.toString?.() ?? sequence.sequenceID ?? "");
    if (!sequenceId) throw new Error("Premiere did not expose a stable sequence identity");
    return { status: "ready", sequence: { projectGuid, id: sequenceId, name: String(sequence.name ?? "") } };
  }
  async activeSequence(): Promise<SequenceInfo | undefined> {
    const context = await this.context();
    return context.status === "ready" ? context.sequence : undefined;
  }
  supportsDirectExport(): boolean {
    const api = this.api();
    return typeof api.EncoderManager?.getManager === "function"
      && typeof api.EncoderManager?.getExportFileExtension === "function"
      && api.Constants?.ExportType?.IMMEDIATELY !== undefined;
  }
  supportsMarkers(): boolean { return typeof this.api().Markers?.getMarkers === "function"; }
}
