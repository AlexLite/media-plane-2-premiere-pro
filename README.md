# Plane × FreeFrame Review for Adobe Premiere Pro

Production-oriented UXP integration scaffold for the Plane ↔ FreeFrame media-review workflow. Plane owns identity, permissions, work-item selection, and the work-item ↔ asset link. FreeFrame owns assets, versions, multipart upload, processing, review comments, and canonical frame positions.

This branch intentionally replaces the original Plane-comments-only prototype. It is a development foundation, not a completed Marketplace package.

## Included architecture

- `PlaneClient`: Plane PAT validation, project/work-item discovery, issue-scoped review session, asset catalog, create/link/unlink.
- `ReviewSessionManager`: Plane-issued token exchange and in-memory-only FreeFrame session lifecycle.
- `FreeFrameClient`: validated review bootstrap, playback metadata, selected-version comments, comment creation/resolution, and authenticated review requests.
- `ReviewTiming`: isolated compatibility adapter that validates rational FPS, prefers the stored annotation frame, and converts legacy FreeFrame seconds only when they resolve to the same canonical frame.
- `ReviewComments`: selected-version loading, current-playhead creation, exact server confirmation, and server-confirmed resolve/reopen.
- `ReviewMarkers`: canonical selected-version marker construction with Plane work-item/version naming, reviewer/status text, immutable FreeFrame comment identity, range duration, and unsafe-timing skips.
- `PremiereMarkerAdapter`: official Premiere UXP 25.6 marker Actions applied through one undoable `Project.executeTransaction`.
- `MultipartUploader`: ordered multipart uploads, ETag capture, per-part disk reads, progress, cancellation, completion, and best-effort abort.
- `ReviewUploadController`: distinct exporting, uploading, processing, ready, failed, and cancelled states.
- `ProcessingPoller`: bounded backoff, sequence/binding cancellation, terminal-state handling, and success only after FreeFrame returns both `ready` and playback metadata.
- `UxpMediaFiles`: exported-file fallback using UXP file pickers and chunked `fs.open/read/close`; the whole media file is never loaded into memory.
- `PremiereDirectExporter`: explicit `.epr` preset and output path using the official Premiere UXP 25.6 `EncoderManager.exportSequence` boundary.
- `BindingStore`: non-secret `Premiere project GUID + sequence GUID → Plane context` mapping and UXP secure storage for the Plane PAT.
- `PremiereAdapter`: isolated Premiere UXP 25.6+ active-context, sequence-duration, and playhead boundary.
- `Diagnostics`: read-only host, storage, exact-binding, Plane, FreeFrame, version, timing, and scope checks with a deliberately redacted copyable report.
- `Shell`: one production-facing Review, Media, and Diagnostics surface with keyboard tab navigation and a locally persisted non-secret active tab.
- Connection and work-item binding UI with current-user validation, workspace/project/work-item discovery, restart restoration, and local-only disconnect.
- Controlled unlinked state and permission-aware asset workflow: Plane-proxied catalog search, video asset creation, cross-service link confirmation, conflict handling, and confirmed remote unlink.
- Compact version-first review UI inspired by the interaction model of Frame.io without copying its branding or pixel design.
- EN/RU locale parity and hardcoded UI-text scanners covering every panel entrypoint.

The runtime must never use ordinary Plane comments as media-review comments, parse semantic timecodes from Plane discussion, persist a FreeFrame token or presigned URL, or accept a user-entered FreeFrame API URL.

## Contract and host dependencies

1. Trusted endpoint discovery requires Plane draft PR [AlexLite/media-plane#27](https://github.com/AlexLite/media-plane/pull/27). Plane must return a server-controlled `freeframe_api_url`; the plugin accepts only an absolute HTTPS endpoint without credentials, query, fragment, or whitespace and fails closed on missing, changed, or unsafe values.
2. Issue-bound version initiation requires FreeFrame draft PR [AlexLite/freeframe-media-plane-review#19](https://github.com/AlexLite/freeframe-media-plane-review/pull/19). The scoped route accepts only the linked `asset_id`, filename, MIME type, and positive file size instead of requiring FreeFrame-internal project fields.
3. Selected-version canonical timing requires FreeFrame draft PR [AlexLite/freeframe-media-plane-review#20](https://github.com/AlexLite/freeframe-media-plane-review/pull/20). The existing worker persists ffprobe video metadata and bootstrap returns optional `duration_seconds`, `fps_numerator`, and `fps_denominator` per version. No migration or new endpoint is introduced.
4. Premiere UXP 25.6 documents `Sequence.getPlayerPosition()`, `Sequence.getEndTime()`, `Markers.getMarkers()`, marker Actions, `TickTime.createWithSeconds()`, `Project.lockedAccess()`, and `Project.executeTransaction()`.
5. The current FreeFrame resolve endpoint toggles resolved state, so resolve/reopen always reconciles from the confirmed server response.

## Review comments, timing, and markers

- Comments are loaded only from the selected FreeFrame version route.
- The annotation `frame_number` is the canonical identity when present.
- Existing seconds-only comments pass through one isolated adapter using the selected version rational FPS. Seconds are never used directly for marker identity.
- A comment with disagreeing frame/seconds, missing timing, a position outside the selected version, or a position outside the active Premiere sequence remains visible with an explicit state and is skipped during marker sync.
- New comments are snapped from the Premiere playhead to the selected version rational FPS and sent with both canonical seconds and annotation frame.
- Creation and resolve/reopen are considered successful only after FreeFrame confirms the exact server state.
- Marker identity includes provider, asset ID, version ID, comment ID, canonical frame, and optional range end.
- Marker sync is scoped to the selected asset/version. It removes stale and duplicate plugin markers only inside that scope and preserves editor markers plus markers from other assets or versions.
- Existing plugin markers are moved back to the canonical frame and updated in place when their name, comments, duration, type, or resolved presentation differs.
- All add/move/update/remove Actions are committed in one Premiere undo step.
- Explicit marker sync enables automatic reconciliation after comment creation or resolve/reopen for the selected version during the current panel session.
- `review:comment` remains server-gated; marker synchronization itself does not modify FreeFrame.

## Export and upload behavior

- Direct export requires an explicitly selected `.epr` preset and output path.
- The exported-file picker is a compatibility fallback, not a replacement for direct export.
- Only video MIME types accepted by the shared FreeFrame API are selectable or exportable.
- Media is read from disk one multipart chunk at a time. File paths, media bytes, presigned URLs, integration tokens, and FreeFrame access tokens are not logged or persisted.
- A sequence switch, local binding change, panel unload, explicit cancellation, authentication failure, upload failure, or processing failure terminates the local operation.
- Upload completion is not presented as success. The panel waits with bounded backoff until the exact uploaded version is `ready` and scoped playback metadata is available.
- The previously ready version remains the visible review state until the new version is fully confirmed.

## Diagnostics and staging validation

The Diagnostics tab is read-only. Its copyable report contains stable check IDs, statuses, boolean capability values, and counts only. It excludes credentials, signed URLs, service origins, project and sequence IDs, work-item IDs, asset/version IDs, local paths, media contents, and raw exception text.

Use the complete [Plane × FreeFrame Premiere staging smoke checklist](docs/staging-smoke-checklist.md) for host, integration, permission, upload, timing, marker, failure, security, and evidence validation. The checklist explicitly prohibits production deployment, merge activity, and `.96` host access during smoke testing.

## Development

Requirements: Node.js for local tooling, Adobe Premiere Pro 25.6 or later, and UXP Developer Tool.

```text
npm ci
npm run check
```

`npm run build` emits `dist/shell.js`, `dist/main.js`, `dist/review-panel.js`, and `dist/diagnostics-panel.js`. `dist/`, `.ccx`, UXP Developer Tool artifacts, credentials, and media exports are intentionally ignored and must not be committed.

To load locally, run the build, add this repository folder in UXP Developer Tool, load it into Premiere Pro, and open **Window → Extensions → Plane × FreeFrame Review**.

## Required host smoke checks

1. Validate the unified Review, Media, and Diagnostics shell at minimum and wide docked widths, including keyboard tab navigation and tab restoration.
2. Validate PAT, work-item binding restoration, local disconnect, asset search/create/link/conflict/unlink, and permission-aware controls against the integration Plane and FreeFrame branches.
3. Confirm `.epr` extension discovery and `exportSequence` acceptance in Premiere Pro 25.6+ with Adobe Media Encoder installed.
4. Determine and implement the documented host mechanism for render progress, render completion/error/cancel events, and host-side render cancellation before claiming direct-export progress/cancellation complete.
5. Verify exported-file chunk reads, multipart CORS/ETag exposure, cancellation/abort, processing polling, and `ready` playback metadata without logging media paths or signed URLs.
6. Verify selected-version FPS/duration, NTSC rates, `getPlayerPosition()`, current-frame comment creation, seconds-only compatibility, timing conflicts, out-of-version/out-of-sequence states, and resolve/reopen against the integration stack.
7. Verify marker collection reads, one-step transaction undo, point/range marker duration, move/update/remove Actions, manual-marker correction, stale/duplicate cleanup, unrelated-marker preservation, and automatic post-write resync in Premiere Pro 25.6+.
8. Copy diagnostics after success and representative failures and confirm the report remains redacted.

## Suggested next slices

1. Run the complete staging checklist against Premiere Pro 25.6+, Plane, FreeFrame, worker, and object storage.
2. Resolve host-smoke findings and consolidate shared runtime state only where the observed workflow requires it.
3. Add documented render-event progress and host cancellation only after the supported Premiere mechanism is verified.

Authoritative specification: [Plane Premiere UXP prompt](https://github.com/AlexLite/media-plane/blob/integration/freeframe-review/docs/uxp-premiere-agent-prompt.md).
