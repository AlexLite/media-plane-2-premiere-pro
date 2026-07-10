import type { Marker, MarkerWrite, SequenceInfo } from "./domain";
import type { MarkerGateway } from "./markers";
declare const require: (name: string) => any;

/** Thin host adapter; keep the DOM-specific API contained here. */
export class PremiereAdapter {
  private app(): any { return require("premierepro").app; }
  activeSequence(): SequenceInfo | undefined {
    const sequence = this.app().project.activeSequence; if (!sequence) return undefined;
    // Premiere's UXP sequence API exposes ticks/timebase differently across releases.
    const fps = Number(sequence.videoFrameRate ?? sequence.frameRate ?? 30);
    const durationSeconds = Number(sequence.duration?.seconds ?? sequence.end?.seconds ?? 0);
    return { id: String(sequence.sequenceID ?? sequence.id), name: sequence.name, fps, durationSeconds };
  }
  markers(): MarkerGateway {
    const sequence = this.app().project.activeSequence;
    if (!sequence) throw new Error("No active sequence");
    const collection = sequence.markers;
    return {
      async list() { const output: Marker[] = []; for (const marker of collection) output.push({ id: String(marker.id ?? marker.guid), startSeconds: Number(marker.start?.seconds ?? marker.startTime?.seconds ?? 0), name: marker.name ?? "", comments: marker.comments ?? marker.comment ?? "" }); return output; },
      async create(value: MarkerWrite) { const marker = collection.createMarker(value.startSeconds); marker.name = value.name; marker.comments = value.comments; },
      async remove(id: string) { const marker = [...collection].find((m: any) => String(m.id ?? m.guid) === id); if (marker) collection.deleteMarker(marker); }
    };
  }
}
