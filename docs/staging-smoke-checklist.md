# Plane × FreeFrame Premiere integration — staging smoke checklist

This checklist validates the Premiere Pro UXP integration against the Plane and FreeFrame integration branches. It is intentionally a staging-only procedure.

## Safety boundary

- Do not merge any dependency or plugin pull request as part of the smoke run.
- Do not deploy to production.
- Do not access or modify the `.96` host.
- Use disposable test work items, assets, media, comments, and Premiere projects.
- Record only redacted diagnostics and test identifiers. Never record Plane PATs, integration tokens, FreeFrame access tokens, presigned URLs, media paths, or media bytes.

## Required revisions

Record the exact commit SHA used for each component:

- Premiere plugin draft PR `AlexLite/media-plane-2-premiere-pro#1`;
- Plane trusted-endpoint draft PR `AlexLite/media-plane#27`;
- FreeFrame upload-contract draft PR `AlexLite/freeframe-media-plane-review#19`;
- FreeFrame timing-contract draft PR `AlexLite/freeframe-media-plane-review#20`;
- FreeFrame integration base `integration/plane-review`;
- Plane integration base `integration/freeframe-review`.

All repository CI suites must be green before host smoke starts.

## Environment prerequisites

- Adobe Premiere Pro 25.6 or later.
- Adobe Media Encoder installed and visible to Premiere.
- Current UXP Developer Tool.
- A staging Plane environment with the public FreeFrame review API URL configured.
- A staging FreeFrame API, database, worker, Redis, and S3/MinIO endpoint.
- Browser/UXP-reachable HTTPS certificates for Plane, FreeFrame, and object storage.
- Multipart CORS that permits the required methods and exposes `ETag` without wildcard production origins.
- At least three Plane users representing read-only, comment/upload, and manage capabilities.
- Test media covering a short MP4 and one larger multipart upload.
- Test sequences at 25 fps, 24000/1001, and 30000/1001.

## Evidence template

For every test case record:

- test case ID;
- pass, fail, or blocked;
- UTC timestamp;
- plugin, Plane, and FreeFrame commit SHAs;
- Premiere and AME versions;
- redacted diagnostic report;
- expected result;
- actual result;
- screenshot or screen recording when useful;
- correlation or request ID when the services expose one safely;
- defect link for every failure.

Do not attach console output containing credentials, signed URLs, service origins, local paths, or media data.

## A. Installation and diagnostics

1. Run `npm ci` and `npm run check` from a clean checkout.
2. Confirm the build produces the expected panel bundles and that generated `dist/` remains untracked.
3. Load the plugin through UXP Developer Tool.
4. Open the panel and confirm a single shell with Review, Media, and Diagnostics tabs.
5. Confirm keyboard left/right navigation moves between tabs and the selected tab restores after reopening the panel.
6. Open Diagnostics and run the checks before entering a Plane credential.
7. Confirm the report marks the active host APIs accurately and shows no credential.
8. Copy the report and inspect it for tokens, URLs, GUIDs, paths, filenames, media contents, and raw exception text. None may be present.
9. Open a project without an active sequence and confirm diagnostics reports the sequence-dependent checks as warning or skipped rather than inventing success.
10. Select a sequence and rerun diagnostics. Confirm project, sequence, playhead, duration, transaction, marker, TickTime, secure storage, and file picker capabilities reflect the actual host.

## B. Plane authentication and sequence binding

1. Validate a correct Plane PAT and confirm the current user is displayed.
2. Reject an incorrect, expired, or revoked PAT without persisting it.
3. Confirm workspace, project, and work-item discovery is limited to the authenticated user.
4. Bind the active sequence to a test work item.
5. Restart Premiere and confirm the exact project GUID plus sequence GUID restores the binding.
6. Duplicate the sequence and confirm the duplicate is not silently treated as the original binding.
7. Replace or recreate the sequence and confirm explicit rebinding is required when identity changes.
8. Disconnect locally and confirm the remote Plane ↔ FreeFrame asset link is unchanged.
9. Switch projects while a request is running and confirm the operation fails closed.
10. Switch active sequences while a request is running and confirm the operation fails closed.

## C. Permission matrix

Run the full relevant flow with each staging user and record the returned scopes.

### Read-only user

- Can load the linked asset, versions, playback state, and public comments.
- Cannot create comments, upload versions, change the asset link, resolve comments, or unlink remotely.
- Marker synchronization remains a local Premiere projection and must not mutate FreeFrame.

### Comment/upload user

- Can create comments at the playhead when `review:comment` is returned.
- Can resolve and reopen comments only when `review:comment` is returned.
- Can upload a new version only when `review:upload` is returned.
- Cannot change or remove the authoritative asset link without `review:manage`.

### Manage user

- Can search, create, link, conflict-check, and explicitly unlink assets.
- Plane and FreeFrame management capability must agree.
- A permission mismatch must fail closed.

## D. Asset discovery and link lifecycle

1. Use an unlinked work item and confirm the controlled unlinked state is visible.
2. Search the scoped catalog and confirm only compatible video assets are selectable.
3. Link an existing compatible asset and confirm success only after Plane and FreeFrame return the exact same asset and work-item context.
4. Attempt to link an asset already linked to another work item. Confirm a visible non-destructive conflict and no local false success.
5. Create a new video asset using the sequence name, edit the name, and link it.
6. Confirm non-video assets cannot be linked by the Premiere workflow.
7. Attempt remote unlink without `review:manage`; confirm no request is made.
8. Confirm remote unlink with a manage user and verify Plane removes its projection only after FreeFrame confirms the unlink.
9. Confirm media, versions, and review data remain in FreeFrame after unlink.

## E. Exported-file fallback and direct export

### Exported-file fallback

1. Select each accepted video extension and confirm the MIME mapping matches the FreeFrame upload contract.
2. Reject unsupported MXF and unrelated file formats before upload initiation.
3. Confirm the panel reads multipart ranges from disk and does not load the complete large file into memory.
4. Cancel the picker and confirm no error or upload is created.

### Direct export

1. Select an explicit `.epr` preset.
2. Confirm Premiere returns a supported output extension before the render starts.
3. Select an explicit output path and verify the path is shown only in the current UI session.
4. Start export with the correct active project and sequence.
5. Change project or sequence before acceptance and confirm the render is not initiated.
6. Confirm `EncoderManager.exportSequence` is accepted with AME installed.
7. Verify the output readiness check does not report upload readiness before a stable non-zero output exists.
8. Close or cancel the local operation and document whether the already accepted AME render continues.
9. Do not claim host-side render cancellation or render-event progress until the supported host mechanism is verified separately.

## F. Multipart upload and processing

1. Upload a file requiring more than one multipart part.
2. Verify parts are numbered in order and completion preserves the exact `ETag` for each part.
3. Confirm presigned upload URLs use HTTPS and are never logged or persisted.
4. Confirm object storage exposes `ETag` to the UXP origin.
5. Interrupt a part upload and verify best-effort abort runs.
6. Cancel during upload and verify the local state becomes cancelled.
7. Change sequence or binding between parts and verify the initiated multipart upload is aborted best-effort.
8. Simulate object-storage unavailability and verify no ready state is shown.
9. Complete multipart upload and confirm the UI moves to processing rather than ready.
10. Confirm polling is bounded and stops on panel disposal, cancellation, authentication failure, sequence change, binding change, processing failure, or timeout.
11. Confirm success only after the exact uploaded version is `ready` and playback metadata is available.
12. Confirm a failed or incomplete version does not replace the previously ready visible review version.

## G. Version selection and canonical timing

Repeat the following at 25 fps, 24000/1001, and 30000/1001.

1. Select a ready FreeFrame version and confirm its duration and rational FPS are displayed.
2. Confirm comments are loaded only from the selected asset/version route.
3. Create a comment at the current Premiere playhead and confirm FreeFrame returns the same canonical frame.
4. Confirm rational conversion round-trips the expected NTSC frame.
5. Load a legacy seconds-only comment and verify the compatibility adapter derives a canonical frame without using display timecode as identity.
6. Create a fixture whose annotation frame and seconds disagree. Confirm it is shown as a timing conflict and does not create a marker.
7. Verify untimed comments remain visible and do not create markers.
8. Verify positions outside the selected version remain visible with a warning and do not create markers.
9. Verify positions inside the version but outside the active sequence remain visible with a warning and do not create markers.
10. Verify an optional range end produces the expected canonical end frame and non-negative duration.
11. Resolve and reopen a comment and confirm the state is accepted only after the server returns the requested value.

## H. Premiere marker reconciliation

1. Select one asset/version and run marker synchronization.
2. Confirm only canonical marker-safe comments create markers.
3. Verify the marker name contains the Plane work-item identifier, selected version, and open/resolved state.
4. Verify marker comments contain reviewer, review status, a safe excerpt, and immutable FreeFrame comment ID.
5. Verify point comments create zero-duration markers.
6. Verify ranged comments create the expected duration.
7. Run synchronization twice and confirm no duplicate marker is created.
8. Move an integration marker manually, rerun sync, and confirm it returns to the canonical frame.
9. Edit the integration marker name or comments, rerun sync, and confirm the authoritative projection is restored.
10. Resolve and reopen the FreeFrame comment and confirm the existing marker presentation updates without changing identity.
11. Delete a FreeFrame comment fixture or remove it from the selected-version response and confirm the stale plugin marker is removed.
12. Create a duplicate plugin marker and confirm only the duplicate inside the selected asset/version scope is removed.
13. Create ordinary editor markers at the same and different positions. Confirm they are never modified or removed.
14. Create integration markers for another asset and another version. Confirm they are preserved.
15. Confirm all add, move, update, and remove Actions appear as one Premiere undo step.
16. Undo once and confirm the entire marker transaction reverts.
17. Redo once and confirm the entire marker transaction reapplies.
18. Save, close, and reopen the Premiere project; rerun sync and confirm idempotency.
19. After explicit sync, create, resolve, and reopen comments and confirm automatic reconciliation stays scoped to the selected version for the current panel session.

## I. Shell and Frame.io-style interaction flow

1. Confirm Review is the default first-class surface.
2. Confirm Media contains connection, binding, asset, export, and upload controls without duplicating the global header.
3. Confirm Diagnostics is available without leaving the panel.
4. Confirm selected version, comments, marker state, and composer remain visually grouped in the Review tab.
5. Confirm upload progress remains visible and cancellable in Media.
6. Confirm tab switching does not cancel an active upload or alter the authoritative review state.
7. Confirm the shell uses Plane and FreeFrame terminology and does not reproduce Frame.io branding or proprietary visual assets.
8. Test at the minimum docked width and at a wider panel width.
9. Verify focus order, arrow-key tab navigation, disabled controls, and visible status feedback.

## J. Failure and recovery matrix

Test each condition independently:

- Plane unavailable;
- FreeFrame unavailable;
- worker unavailable;
- Redis unavailable;
- S3/MinIO unavailable;
- storage CORS missing `ETag` exposure;
- unsafe or changed server-controlled FreeFrame public URL;
- expired Plane PAT;
- expired integration token;
- expired FreeFrame session;
- wrong work-item context;
- linked asset mismatch;
- permission mismatch;
- malformed bootstrap, version, comment, author, annotation, or playback payload;
- upload part failure;
- processing terminal failure;
- processing timeout;
- sequence switch;
- project switch;
- local binding change;
- panel unload.

For every case confirm the panel fails closed, does not expose secrets, does not display false success, and can recover through a controlled refresh or reauthentication when the underlying condition is corrected.

## K. Security inspection

1. Inspect UXP local storage. It may contain only the non-secret project GUID plus sequence GUID to Plane context mapping and selected shell tab.
2. Inspect UXP secure storage access. The Plane PAT must be stored only there.
3. Confirm the FreeFrame session token remains memory-only and disappears after panel disposal or session clearing.
4. Confirm presigned URLs remain memory-only.
5. Confirm exported media paths are not persisted or logged.
6. Confirm media bytes are never included in diagnostics or application logs.
7. Confirm ordinary Plane comments are never treated as media-review comments.
8. Confirm user-entered or work-item-derived FreeFrame origins are rejected.
9. Confirm copied diagnostics remain redacted even when an underlying exception contains a token, URL, GUID, or path.

## Exit criteria

The staging smoke run is complete only when:

- all automated repository suites are green on the exact tested commits;
- every required test case is pass or has an accepted, linked blocker;
- no secret, signed URL, local path, or media content appears in logs, screenshots, or diagnostics;
- marker sync is idempotent, scoped, one-step undoable, and preserves unrelated markers;
- direct export limitations are accurately documented and not overstated;
- server dependency PRs are reviewed independently;
- no production deployment or merge has occurred during validation.
