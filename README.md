# Plane × FreeFrame Review for Adobe Premiere Pro

Production-oriented UXP integration scaffold for the Plane ↔ FreeFrame media-review workflow. Plane owns identity, permissions, work-item selection, and the work-item ↔ asset link. FreeFrame owns assets, versions, multipart upload, processing, review comments, and canonical frame positions.

This branch intentionally replaces the original Plane-comments-only prototype. It is a development foundation, not a completed Marketplace package.

## Included architecture

- `PlaneClient`: Plane PAT validation, project/work-item discovery, issue-scoped review session, asset catalog, create/link/unlink.
- `ReviewSessionManager`: Plane-issued token exchange and in-memory-only FreeFrame session lifecycle.
- `FreeFrameClient`: validated review bootstrap, playback metadata, version comments, comment creation/resolution, and authenticated review requests.
- `MultipartUploader`: ordered multipart uploads, ETag capture, per-part disk reads, progress, cancellation, completion, and best-effort abort.
- `ReviewUploadController`: distinct exporting, uploading, processing, ready, failed, and cancelled states.
- `ProcessingPoller`: bounded backoff, sequence/binding cancellation, terminal-state handling, and success only after FreeFrame returns both `ready` and playback metadata.
- `UxpMediaFiles`: exported-file fallback using UXP file pickers and chunked `fs.open/read/close`; the whole media file is never loaded into memory.
- `PremiereDirectExporter`: explicit `.epr` preset and output path using the official Premiere UXP 25.6 `EncoderManager.exportSequence` boundary.
- `BindingStore`: non-secret `Premiere project GUID + sequence GUID → Plane context` mapping and UXP secure storage for the Plane PAT.
- `PremiereAdapter`: isolated Premiere UXP 25.6+ capability and active-context boundary.
- Canonical FreeFrame marker identity and rational frame/time conversion.
- Connection and work-item binding UI with current-user validation, workspace/project/work-item discovery, restart restoration, and local-only disconnect.
- Controlled unlinked state and permission-aware asset workflow: Plane-proxied catalog search, video asset creation, cross-service link confirmation, conflict handling, and confirmed remote unlink.
- EN/RU locale dictionaries, parity coverage, and a hardcoded UI-text scanner.

The runtime must never use ordinary Plane comments as media-review comments, parse semantic timecodes from Plane discussion, persist a FreeFrame token or presigned URL, or accept a user-entered FreeFrame API URL.

## Contract and host dependencies

1. Trusted endpoint discovery requires Plane draft PR [AlexLite/media-plane#27](https://github.com/AlexLite/media-plane/pull/27). Plane must return a server-controlled `freeframe_api_url`; the plugin accepts only an absolute HTTPS endpoint without credentials, query, fragment, or whitespace and fails closed on missing, changed, or unsafe values.
2. Issue-bound version initiation requires FreeFrame draft PR [AlexLite/freeframe-media-plane-review#19](https://github.com/AlexLite/freeframe-media-plane-review/pull/19). The scoped route accepts only the linked `asset_id`, filename, MIME type, and positive file size instead of requiring FreeFrame-internal project fields.
3. Premiere UXP 25.6 documents `EncoderManager.exportSequence` and render events, but the current public reference does not document the render-event subscription or host-side cancellation mechanism. The adapter therefore keeps that capability behind an explicit host-smoke TODO. Local waiting, multipart upload, and processing polling are cancellation-aware; a render already accepted by Premiere may continue.
4. The current FreeFrame resolve endpoint toggles resolved state, so resolve/reopen must reconcile from the confirmed server response.

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

`npm run build` emits `dist/main.js`. `dist/`, `.ccx`, UXP Developer Tool artifacts, credentials, and media exports are intentionally ignored and must not be committed.

To load locally, run the build, add this repository folder in UXP Developer Tool, load it into Premiere Pro, and open **Window → Extensions → Plane × FreeFrame Review**.

## Required host smoke checks

1. Validate PAT, work-item binding restoration, local disconnect, asset search/create/link/conflict/unlink, and permission-aware controls against the integration Plane and FreeFrame branches.
2. Confirm `.epr` extension discovery and `exportSequence` acceptance in Premiere Pro 25.6+ with Adobe Media Encoder installed.
3. Determine and implement the documented host mechanism for render progress, render completion/error/cancel events, and host-side render cancellation before claiming direct-export progress/cancellation complete.
4. Verify exported-file chunk reads, multipart CORS/ETag exposure, cancellation/abort, processing polling, and `ready` playback metadata without logging media paths or signed URLs.

## Suggested next slices

1. Implement FreeFrame review comments by selected version, canonical frame/rational-FPS validation, comment composition at the current playhead, and server-confirmed resolve/reopen.
2. Implement marker Actions inside `Project.executeTransaction`, then verify idempotent reconciliation and unrelated-marker preservation in Premiere.
3. Add diagnostics and the complete Plane/FreeFrame/Premiere staging smoke checklist.

Authoritative specification: [Plane Premiere UXP prompt](https://github.com/AlexLite/media-plane/blob/integration/freeframe-review/docs/uxp-premiere-agent-prompt.md).
