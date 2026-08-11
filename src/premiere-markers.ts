import type { Marker, MarkerWrite } from "./domain";
import { planMarkerReconciliation, type DesiredMarker, type MarkerReconciliationPlan, type MarkerScope } from "./markers";

declare const require: (name: string) => any;

export interface PremiereMarkerSyncResult {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  ignored: number;
}

interface HostMarkerSnapshot extends Marker { raw: any }

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Premiere returned invalid marker timing");
  return number;
}

async function resolveValue<T>(value: T | Promise<T>): Promise<T> { return await value; }

/** Official Premiere UXP 25.6 marker Actions and transaction boundary. */
export class PremiereMarkerAdapter {
  constructor(private readonly runtime: () => any = () => require("premierepro")) {}

  private api(): any { return this.runtime(); }

  private async active(expectedProjectGuid: string, expectedSequenceId: string): Promise<{ project: any; sequence: any }> {
    const api = this.api();
    const project = await api.Project.getActiveProject();
    if (!project || String(project.guid?.toString?.() ?? "") !== expectedProjectGuid) throw new Error("The active Premiere project changed");
    const sequence = await project.getActiveSequence();
    const sequenceId = String(sequence?.guid?.toString?.() ?? sequence?.sequenceID ?? "");
    if (!sequence || sequenceId !== expectedSequenceId) throw new Error("The active Premiere sequence changed");
    if (typeof project.executeTransaction !== "function") throw new Error("Premiere transaction API is unavailable");
    return { project, sequence };
  }

  private async snapshots(collection: any): Promise<HostMarkerSnapshot[]> {
    const hostMarkers = await resolveValue(collection.getMarkers([]));
    if (!Array.isArray(hostMarkers)) throw new Error("Premiere returned invalid markers");
    const result: HostMarkerSnapshot[] = [];
    for (let index = 0; index < hostMarkers.length; index += 1) {
      const raw = hostMarkers[index];
      const [start, duration, name, comments, markerType] = await Promise.all([
        resolveValue(raw.getStart()),
        resolveValue(raw.getDuration()),
        resolveValue(raw.getName()),
        resolveValue(raw.getComments()),
        resolveValue(raw.getType()),
      ]);
      const guid = String(raw.guid?.toString?.() ?? "");
      result.push({
        id: guid || `host-marker-${index}`,
        startSeconds: finiteNonNegative(start?.seconds),
        durationSeconds: finiteNonNegative(duration?.seconds),
        name: String(name ?? ""),
        comments: String(comments ?? ""),
        markerType: String(markerType ?? ""),
        raw,
      });
    }
    return result;
  }

  private tick(seconds: number): any {
    const api = this.api();
    if (typeof api.TickTime?.createWithSeconds !== "function") throw new Error("Premiere TickTime API is unavailable");
    return api.TickTime.createWithSeconds(finiteNonNegative(seconds));
  }

  private add(compound: any, action: any): void {
    if (!action || typeof compound.addAction !== "function" || compound.addAction(action) !== true) {
      throw new Error("Premiere rejected a marker action");
    }
  }

  private actions(collection: any, snapshots: HostMarkerSnapshot[], plan: MarkerReconciliationPlan, compound: any): void {
    const byId = new Map(snapshots.map(marker => [marker.id, marker]));
    for (const id of plan.remove) {
      const existing = byId.get(id);
      if (!existing) throw new Error("Premiere marker changed before reconciliation");
      this.add(compound, collection.createRemoveMarkerAction(existing.raw));
    }
    for (const update of plan.update) {
      const existing = byId.get(update.id);
      if (!existing) throw new Error("Premiere marker changed before reconciliation");
      const desired = update.marker;
      if (Math.abs(existing.startSeconds - desired.startSeconds) > 1e-6) this.add(compound, collection.createMoveMarkerAction(existing.raw, this.tick(desired.startSeconds)));
      if (Math.abs((existing.durationSeconds ?? 0) - (desired.durationSeconds ?? 0)) > 1e-6) this.add(compound, existing.raw.createSetDurationAction(this.tick(desired.durationSeconds ?? 0)));
      if (existing.name !== desired.name) this.add(compound, existing.raw.createSetNameAction(desired.name));
      if (existing.comments !== desired.comments) this.add(compound, existing.raw.createSetCommentsAction(desired.comments));
      if ((existing.markerType ?? "") !== (desired.markerType ?? "Comment")) this.add(compound, existing.raw.createSetTypeAction(desired.markerType ?? "Comment"));
    }
    for (const marker of plan.create) {
      this.add(compound, collection.createAddMarkerAction(
        marker.name,
        marker.markerType ?? "Comment",
        this.tick(marker.startSeconds),
        this.tick(marker.durationSeconds ?? 0),
        marker.comments,
      ));
    }
  }

  async reconcile(
    expectedProjectGuid: string,
    expectedSequenceId: string,
    desired: DesiredMarker[],
    scope: MarkerScope,
    undoLabel: string,
  ): Promise<PremiereMarkerSyncResult> {
    const api = this.api();
    if (typeof api.Markers?.getMarkers !== "function") throw new Error("Premiere marker API is unavailable");
    const { project, sequence } = await this.active(expectedProjectGuid, expectedSequenceId);
    const collection = await api.Markers.getMarkers(sequence);
    if (!collection || typeof collection.getMarkers !== "function") throw new Error("Premiere marker collection is unavailable");
    const snapshots = await this.snapshots(collection);
    const plan = planMarkerReconciliation(snapshots, desired, scope);
    if (plan.create.length || plan.update.length || plan.remove.length) {
      let executed = false;
      const run = () => {
        executed = project.executeTransaction((compound: any) => this.actions(collection, snapshots, plan, compound), undoLabel) === true;
      };
      if (typeof project.lockedAccess === "function") project.lockedAccess(run);
      else run();
      if (!executed) throw new Error("Premiere did not execute the marker transaction");
      await this.active(expectedProjectGuid, expectedSequenceId);
    }
    return {
      created: plan.create.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      unchanged: plan.unchanged,
      ignored: plan.ignored,
    };
  }
}
