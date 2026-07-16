# Plane × FreeFrame Review for Adobe Premiere Pro

Production-oriented UXP integration scaffold for the Plane ↔ FreeFrame media-review workflow. Plane owns identity, permissions, work-item selection, and the work-item ↔ asset link. FreeFrame owns assets, versions, multipart upload, processing, review comments, and canonical frame positions.

This branch intentionally replaces the original Plane-comments-only prototype. It is a development foundation, not a completed Marketplace package.

## Included architecture

- `PlaneClient`: Plane PAT validation, project/work-item discovery, issue-scoped review session, asset catalog, create/link/unlink.
- `ReviewSessionManager`: Plane-issued token exchange and in-memory-only FreeFrame session lifecycle.
- `FreeFrameClient`: validated review bootstrap, playback metadata, selected-version comments, comment creation/resolution, and authenticated review requests.
- `ReviewTiming`: isolated compatibility adapter that validates rational FPS, prefers the stored annotation frame, and converts legacy FreeFrame seconds only when they resolve to the same canonical frame.
- `ReviewComments`: selected-version loading, current-playhead creation, exact server confirmation, and server-confirmed resolve/reopen.
- `MultipartUploader`: ordered multipart uploads, ETag capture, per-part disk reads, progress, cancellation, completion, and best-effort abort.
- `ReviewUploadController`: distinct exporting, uploading, processing, ready, failed, and cancelled states.
- `ProcessingPoller`: bounded backoff, sequence/binding cancellation, terminal-state handling, and success only after FreeFrame returns both `ready` and playback metadata.
- `UxpMediaFiles`: exported-file fallback using UXP file pickers and chunked `fs.open/read/close`; the whole media file is never loaded into memory.
- `PremiereDirectExporter`: explicit `.epr` preset and output path using the official Premiere UXP 25.6 `EncoderManager.exportSequence` boundary.
- `BindingStore`: non-secret `Premiere project GUID + sequence GUID → Plane context` mapping and UXP secure storage for the Plane PAT.
- `PremiereAdapter`: isolated Premiere UXP 25.6+ active-context, sequence-duration, and playhead boundary.
- Connection and work-item binding UI with current-user validation, workspace/project/work-item discovery, restart restoration, and local-only disconnect.
- Controlled unlinked state and permission-aware asset workflow: Plane-proxied catalog search, video asset creation, cross-service link confirmation, conflict handling, and confirmed remote unlink.
- A separate comments entrypoint inside the same UXP panel. It reuses the exact local sequence binding and issue-bound session; it introduces no second login, endpoint, or backend.
- EN/RU locale dictionaries, parity coverage, and a hardcoded UI-text scanner covering both panel entrypoints.

The runtime must never use ordinary Plane comments as media-review comments, parse semantic timecodes from Plane discussion, persist a FreeFrame token or presigned URL, or accept a user-entered FreeFrame API URL.

## Contract and host dependencies

1. Trusted endpoint discovery requires Plane draft PR [AlexLite/media-plane#27](https://github.com/AlexLite/media-plane/pull/27). Plane must return a server-controlled `freeframe_api_url`; the plugin accepts only an absolute HTTPS endpoint without credentials, query, fragment, or whitespace and fails closed on missing, changed, or unsafe values.
2. Issue-bound version initiation requires FreeFrame draft PR [AlexLite/freeframe-media-plane-review#19](https://github.com/AlexLite/freeframe-media-plane-review/pull/19). The scoped route accepts only the linked `asset_id`, filename, MIME type, and positive file size instead of requiring FreeFrame-internal project fields.
3. Selected-version canonical timing requires FreeFrame draft PR [AlexLite/freeframe-media-plane-review#20](https://github.com/AlexLite/freeframe-media-plane-review/pull/20). The existing worker persists ffprobe video metadata and bootstrap returns optional `duration_seconds`, `fps_numerator`, and `fps_denominator` per version. No migration or new endpoint is introduced.
4. Premiere UXP 25.6 documents `Sequence.getPlayerPosition()`, `Sequence.getEndTime()`, `TickTime.seconds`, and `EncoderManager.exportSequence`. The plugin validates the active project and sequence before and after comment/transfer operations.
5. The current FreeFrame resolve endpoint toggles resolved state, so resolve/reopen always reconciles from the confirmed server response.

## Review comments and timing

- Comments are loaded only from the selected FreeFrame version route.
- The annotation `frame_number` is the canonical identity when present.
- Existing seconds-only comments pass through one isolated adapter using the selected version rational FPS. Seconds are never used directly for marker identity.
- A comment with disagreeing frame/seconds, missing timing, a position outside the selected version, or a position outside the active Premiere sequence remains visible with an explicit state; no marker is created from it.
- New comments are snapped from the Premiere playhead to the selected version rational FPS and sent with both canonical seconds and annotation frame.
- Creation is considered successful only when FreeFrame returns the exact asset, version, and canonical frame.
- Resolve/reopen is considered successful only when the toggle response confirms the requested state.
- `review:comment` is enforced from server-returned permissions; without it the list is read-only.

## Export and upload behavior

- Direct export requires an explicitly selected `.epr` preset and output path.
- The exported-file picker is a compatibility fallback, not a replacement for direct export.
- Only video MIME types accepted by the shared FreeFrame API are selectable or exportable.
- Media is read from disk one multipart chunk at a time. File paths, media bytes, presigned URLs, integration tokens, and FreeFrame access tokens are not logged or persisted.
- A sequence switch, local binding change, panel unload, explicit cancellation, authentication failure, upload failure, or processing failure terminates the local operation.
- Upload completion is not presented as success. The panel waits with bounded backoff until the exact uploaded version is `ready` and scoped playback metadata is available.
- The previously ready version remains the visible review state until the new version is fully confirmed.

## Development

Requirements: Node.js for local tooling, Adobe Premiere Pro 25.6 or later, and UXP Developer Tool.

```text
npm ci
npm run check
```

`npm run build` emits `dist/main.js` and `dist/review-panel.js`. `dist/`, `.ccx`, UXP Developer Tool artifacts, credentials, and media exports are intentionally ignored and must not be committed.

To load locally, run the build, add this repository folder in UXP Developer Tool, load it into Premiere Pro, and open **Window → Extensions → Plane × FreeFrame Review**.

## Required host smoke checks

1. Validate PAT, work-item binding restoration, local disconnect, asset search/create/link/conflict/unlink, and permission-aware controls against the integration Plane and FreeFrame branches.
2. Confirm `.epr` extension discovery and `exportSequence` acceptance in Premiere Pro 25.6+ with Adobe Media Encoder installed.
3. Determine and implement the documented host mechanism for render progress, render completion/error/cancel events, and host-side render cancellation before claiming direct-export progress/cancellation complete.
4. Verify exported-file chunk reads, multipart CORS/ETag exposure, cancellation/abort, processing polling, and `ready` playback metadata without logging media paths or signed URLs.
5. Verify selected-version FPS/duration, NTSC rates, `getPlayerPosition()`, current-frame comment creation, seconds-only compatibility, timing conflicts, out-of-version/out-of-sequence states, and resolve/reopen against the integration stack.

## Suggested next slices

1. Implement marker Actions inside `Project.executeTransaction`, then verify idempotent reconciliation, resolve/reopen updates, stale-marker removal, and unrelated-marker preservation in Premiere.
2. Add diagnostics and the complete Plane/FreeFrame/Premiere staging smoke checklist.

Authoritative specification: [Plane Premiere UXP prompt](https://github.com/AlexLite/media-plane/blob/integration/freeframe-review/docs/uxp-premiere-agent-prompt.md).
