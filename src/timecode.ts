import type { PlaneTimecode } from "./domain";

const TIME = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)$/;
export function parseTimecode(value: string): number | undefined {
  const m = TIME.exec(value.trim());
  if (!m) return undefined;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
}
export function validTimecodes(items: PlaneTimecode[] | undefined): PlaneTimecode[] {
  return (items ?? []).filter((item) => parseTimecode(item.value) === item.seconds);
}
/** Compatibility-only parser for Plane servers that do not provide computed timecodes. */
export function timecodesFromHtml(html: string): PlaneTimecode[] {
  const matches = html.matchAll(/<span\s+[^>]*data-plane-timecode=["'](\d{2}:\d{2}:\d{2})["'][^>]*>/gi);
  const result: PlaneTimecode[] = [];
  for (const match of matches) { const seconds = parseTimecode(match[1]); if (seconds !== undefined) result.push({ value: match[1], seconds }); }
  return result;
}
