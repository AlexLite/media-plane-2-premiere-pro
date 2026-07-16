import type { PremiereContext, SequenceInfo } from "./domain";
declare const require: (name: string) => any;

export interface PremierePlayhead { seconds: number; sequenceDurationSeconds?: number }

/** Official Premiere UXP 25.6+ context and playhead boundary. */
export class PremiereAdapter {
  constructor(private readonly runtime: () => any = () => require("premierepro")) {}
  private api(): any { return this.runtime(); }
  private async active(expectedProjectGuid?: string, expectedSequenceId?: string): Promise<{ project: any; sequence: any; projectGuid: string; sequenceId: string }> {
    const project = await this.api().Project.getActiveProject();
    if (!project) throw new Error("No active Premiere project");
    const projectGuid = String(project.guid?.toString?.() ?? "");
    if (!projectGuid || (expectedProjectGuid && projectGuid !== expectedProjectGuid)) throw new Error("The active Premiere project changed");
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("No active Premiere sequence");
    const sequenceId = String(sequence.guid?.toString?.() ?? sequence.sequenceID ?? "");
    if (!sequenceId || (expectedSequenceId && sequenceId !== expectedSequenceId)) throw new Error("The active Premiere sequence changed");
    return { project, sequence, projectGuid, sequenceId };
  }
  private async duration(sequence: any): Promise<number | undefined> {
    if (typeof sequence.getEndTime !== "function") return undefined;
    const end = await sequence.getEndTime();
    const seconds = Number(end?.seconds);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }
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
    const durationSeconds = await this.duration(sequence);
    const info: SequenceInfo = { projectGuid, id: sequenceId, name: String(sequence.name ?? "") };
    if (durationSeconds !== undefined) info.durationSeconds = durationSeconds;
    return { status: "ready", sequence: info };
  }
  async activeSequence(): Promise<SequenceInfo | undefined> {
    const context = await this.context();
    return context.status === "ready" ? context.sequence : undefined;
  }
  async playhead(expectedProjectGuid: string, expectedSequenceId: string): Promise<PremierePlayhead> {
    const { sequence } = await this.active(expectedProjectGuid, expectedSequenceId);
    if (typeof sequence.getPlayerPosition !== "function") throw new Error("Premiere playhead API is unavailable");
    const position = await sequence.getPlayerPosition();
    const seconds = Number(position?.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Premiere returned an invalid playhead position");
    return { seconds, sequenceDurationSeconds: await this.duration(sequence) };
  }
  supportsDirectExport(): boolean {
    const api = this.api();
    return typeof api.EncoderManager?.getManager === "function" && typeof api.EncoderManager?.getExportFileExtension === "function" && api.Constants?.ExportType?.IMMEDIATELY !== undefined;
  }
  supportsMarkers(): boolean { return typeof this.api().Markers?.getMarkers === "function"; }
}
