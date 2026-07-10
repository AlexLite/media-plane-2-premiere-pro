import type { Marker, MarkerWrite } from "./domain";

export interface MarkerIdentity { plugin: "plane-timecode-review"; commentId: string; timecode: string }
const PREFIX = "[plane-timecode-review]";
export function serializeIdentity(identity: MarkerIdentity): string { return `${PREFIX}${JSON.stringify(identity)}`; }
export function readIdentity(comment: string): MarkerIdentity | undefined {
  if (!comment.startsWith(PREFIX)) return undefined;
  const firstLine = comment.slice(PREFIX.length).split("\n", 1)[0];
  try { const v = JSON.parse(firstLine); return v.plugin === "plane-timecode-review" && typeof v.commentId === "string" && typeof v.timecode === "string" ? v : undefined; } catch { return undefined; }
}
export function markerKey(identity: Pick<MarkerIdentity, "commentId" | "timecode">) { return `${identity.commentId}\u0000${identity.timecode}`; }
export interface MarkerGateway { list(): Promise<Marker[]>; create(marker: MarkerWrite): Promise<void>; remove(id: string): Promise<void> }
export interface DesiredMarker { identity: MarkerIdentity; startSeconds: number; name: string; comment: string }
export async function reconcileMarkers(gateway: MarkerGateway, desired: DesiredMarker[]): Promise<void> {
  const existing = await gateway.list();
  const required = new Map(desired.map(item => [markerKey(item.identity), item]));
  const seen = new Set<string>();
  for (const marker of existing) {
    const identity = readIdentity(marker.comments); if (!identity) continue;
    const key = markerKey(identity);
    if (!required.has(key) || seen.has(key)) await gateway.remove(marker.id); else seen.add(key);
  }
  for (const [key, marker] of required) if (!seen.has(key)) await gateway.create({ startSeconds: marker.startSeconds, name: marker.name, comments: `${serializeIdentity(marker.identity)}\n${marker.comment}` });
}
