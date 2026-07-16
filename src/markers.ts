import type { Marker, MarkerWrite } from "./domain";

export interface MarkerIdentity { plugin: "plane-freeframe-review"; assetId: string; versionId: string; commentId: string; frameNumber: number; rangeEndFrame?: number | null }
const PREFIX = "[plane-freeframe-review]";
export function serializeIdentity(identity: MarkerIdentity): string { return `${PREFIX}${JSON.stringify(identity)}`; }
export function readIdentity(comment: string): MarkerIdentity | undefined {
  if (!comment.startsWith(PREFIX)) return undefined;
  try {
    const value = JSON.parse(comment.slice(PREFIX.length).split("\n", 1)[0]) as Partial<MarkerIdentity>;
    return value.plugin === "plane-freeframe-review" && typeof value.assetId === "string" && typeof value.versionId === "string" && typeof value.commentId === "string" && Number.isInteger(value.frameNumber) ? value as MarkerIdentity : undefined;
  } catch { return undefined; }
}
export function markerKey(value: MarkerIdentity): string { return [value.assetId, value.versionId, value.commentId, value.frameNumber, value.rangeEndFrame ?? ""].join("\u0000"); }
export interface MarkerGateway { list(): Promise<Marker[]>; create(marker: MarkerWrite): Promise<void>; remove(id: string): Promise<void> }
export interface DesiredMarker { identity: MarkerIdentity; startSeconds: number; name: string; comment: string }
export async function reconcileMarkers(gateway: MarkerGateway, desired: DesiredMarker[]): Promise<void> {
  const existing = await gateway.list(); const required = new Map(desired.map(value => [markerKey(value.identity), value])); const seen = new Set<string>();
  for (const marker of existing) { const identity = readIdentity(marker.comments); if (!identity) continue; const key = markerKey(identity); if (!required.has(key) || seen.has(key)) await gateway.remove(marker.id); else seen.add(key); }
  for (const [key, marker] of required) if (!seen.has(key)) await gateway.create({ startSeconds: marker.startSeconds, name: marker.name, comments: `${serializeIdentity(marker.identity)}\n${marker.comment}` });
}
