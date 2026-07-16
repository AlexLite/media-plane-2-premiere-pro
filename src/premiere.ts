import type { SequenceInfo } from "./domain";
declare const require: (name: string) => any;

/** Official Premiere UXP 25.6+ boundary. Marker/export writes stay explicit TODOs until host smoke tests. */
export class PremiereAdapter {
  private api(): any { return require("premierepro"); }
  async activeSequence(): Promise<SequenceInfo | undefined> {
    const api = this.api(); const project = await api.Project.getActiveProject();
    if (!project) return undefined;
    const sequence = await project.getActiveSequence(); if (!sequence) return undefined;
    const sequenceId = String(sequence.guid?.toString?.() ?? sequence.sequenceID ?? "");
    if (!sequenceId) throw new Error("Premiere did not expose a stable sequence identity");
    return { projectGuid: String(project.guid.toString()), id: sequenceId, name: String(sequence.name ?? "") };
  }
  supportsDirectExport(): boolean { return typeof this.api().EncoderManager?.exportSequence === "function"; }
  supportsMarkers(): boolean { return typeof this.api().Markers?.getMarkers === "function"; }
}
