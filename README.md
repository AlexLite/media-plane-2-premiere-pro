# Plane Timecode Review for Premiere Pro

A UXP panel that binds the active Premiere sequence to one Plane work item. It reads the flat Plane comment stream, renders computed Plane timecodes, and reconciles only markers it owns.

## Requirements and setup

- Adobe Premiere Pro **25.0 or later** with UXP support, and the Adobe UXP Developer Tool.
- Node.js is required only for the local build/test commands; the shipped panel has no Node runtime dependency.
- Run `npm install`, then `npm run build` (or keep rebuilding after changes).
- In UXP Developer Tool, add this folder as a plugin, load it, then open **Window → Extensions → Plane Review** in Premiere.
- Open a sequence, enter the Plane base URL, a Plane personal access token, workspace slug, project ID, and work-item ID. Validate and save. The token is held in UXP secure storage; the sequence mapping is held in UXP local storage.

The manifest permits HTTPS network destinations. For a self-hosted HTTP Plane instance, change the manifest permission deliberately and use a trusted development environment.

## Behaviour

- The normal Plane work-item, comment, and state endpoints are used. Reply payloads use `comment_html`; comments are never treated as nested replies.
- `timecodes` supplied by Plane are used first. Only absent computed fields fall back to exact `<span data-plane-timecode="HH:MM:SS">` parsing.
- Timecodes resolve by their seconds against sequence duration (Premiere owns the sequence timebase). Values outside duration remain checked and do not create a marker.
- Checked means marker absent; unchecked means marker present. Marker metadata encodes the plugin ID, Plane comment ID, and timecode. Reconciliation therefore never removes editor markers or markers created by another plugin.

## Manual test checklist

1. Open a sequence and bind it to a test Plane item; reload the panel and confirm the binding returns.
2. Confirm token is not visible in local-storage/devtools values, then restart Premiere and confirm the connection reads it from secure storage.
3. Add comments with multiple Plane timecodes; verify they group below their source comment and create correctly named markers at their exact seconds.
4. Toggle each checkbox twice, refresh, and restart the panel; verify no duplicate markers result.
5. Add a normal Premiere marker at the same time and toggle the Plane item; verify the normal marker stays.
6. Test a timecode beyond sequence duration; verify warning, checked state, and no marker.
7. Post a reply and change a status; verify each appears in Plane.

## Commands

`npm test` runs unit tests for timecode rules/fallback, marker identity, and idempotent marker reconciliation. `npm run build` emits `dist/main.js` for UXP.
