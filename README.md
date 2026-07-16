# Plane × FreeFrame Review for Adobe Premiere Pro

Production-oriented UXP integration scaffold for the Plane ↔ FreeFrame media-review workflow. Plane owns identity, permissions, work-item selection, and the work-item ↔ asset link. FreeFrame owns assets, versions, multipart upload, processing, review comments, and canonical frame positions.

This branch intentionally replaces the original Plane-comments-only prototype. It is a development foundation, not a completed Marketplace package.

## Included architecture

- `PlaneClient`: Plane PAT validation, project/work-item discovery, issue-scoped review session, asset catalog, create/link/unlink.
- `ReviewSessionManager`: Plane-issued token exchange and in-memory-only FreeFrame session lifecycle.
- `FreeFrameClient`: review bootstrap, version comments, comment creation/resolution, and authenticated review requests.
- `MultipartUploader`: ordered multipart uploads, ETag capture, progress, cancellation, completion, and best-effort abort.
- `BindingStore`: non-secret `Premiere project GUID + sequence GUID → Plane context` mapping and UXP secure storage for the Plane PAT.
- `PremiereAdapter`: isolated Premiere UXP 25.6+ capability boundary.
- Canonical FreeFrame marker identity and rational frame/time conversion.
- Connection and work-item binding UI with current-user validation, workspace/project/work-item discovery, restart restoration, and local-only disconnect.
- Controlled unlinked state and permission-aware asset workflow: Plane-proxied catalog search, video asset creation, cross-service link confirmation, conflict handling, and confirmed remote unlink.
- EN/RU locale dictionaries, parity coverage, and a hardcoded UI-text scanner.

The runtime must never use ordinary Plane comments as media-review comments, parse semantic timecodes from Plane discussion, persist a FreeFrame token, or accept a user-entered FreeFrame API URL.

## Contract and host dependencies

1. Trusted endpoint discovery is implemented in the plugin and requires Plane draft PR [AlexLite/media-plane#27](https://github.com/AlexLite/media-plane/pull/27). Plane must return a server-controlled `freeframe_api_url`; the plugin accepts only an absolute HTTPS endpoint without credentials, query, fragment, or whitespace and fails closed on missing, changed, or unsafe values.
2. The current FreeFrame resolve endpoint toggles resolved state, so the same server-confirmed operation is used for resolve/reopen; clients must reconcile from its response.
3. Premiere UXP 25.6 documents [`EncoderManager.exportSequence`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager) and [marker Actions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers). Export progress/cancellation and transactional marker writes still require host smoke testing before the adapters are completed.
4. Direct export should remain the target path. Selecting an already exported file is the compatibility fallback.

## Development

Requirements: Node.js for local tooling, Adobe Premiere Pro 25.6 or later, and UXP Developer Tool.

```text
npm ci
npm run check
```

`npm run build` emits `dist/main.js`. `dist/`, `.ccx`, UXP Developer Tool artifacts, credentials, and media exports are intentionally ignored and must not be committed.

To load locally, run the build, add this repository folder in UXP Developer Tool, load it into Premiere Pro, and open **Window → Extensions → Plane × FreeFrame Review**. The panel can validate Plane credentials, display the current user, select and restore a work-item binding, show the authoritative linked/unlinked review state, search or create compatible video assets through Plane, confirm links against FreeFrame, and perform an explicitly confirmed remote unlink only with `review:manage`.

## Suggested next slices

1. Complete exported-file fallback and direct `EncoderManager.exportSequence` adapter with progress/cancellation smoke tests.
2. Connect `MultipartUploader`, bounded processing polling, version history, and terminal states.
3. Implement marker Actions inside `Project.executeTransaction`, then verify idempotent reconciliation in Premiere.
4. Add comment composer, server-response-driven resolve/reopen reconciliation, diagnostics, and staging smoke coverage.

Authoritative specification: [Plane Premiere UXP prompt](https://github.com/AlexLite/media-plane/blob/integration/freeframe-review/docs/uxp-premiere-agent-prompt.md).
