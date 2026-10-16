---
status: accepted
supersedes: the OBS parts of 0036, 0037, 0044 and 0050
---

# The CVM recorder is the only Recorder

Decided by Matt on 2026-10-16 (#2277): "I would like to disable the OBS recorder. Let's rip out all the code for it, apart from handling clips that were recorded that way. Let's make the CVM recorder the only way."

## Decision

1. **Every Video records with the CVM recorder.** The editor no longer connects to OBS: its websocket connector, Virtual Camera preview, profile switch, browser speech detector, calibration gate and file polling (`appendFromObs`) are deleted, as are the Recorder picker and the thumbnail editor's OBS camera.
2. **A Video has no Recorder of its own.** `video.recorder` keeps its column, its check constraint and every stored value, but nothing reads or writes it. Every Video is read as the CVM recorder's, whatever it stored: no migration, no data changed. Dropping the column is a separate, one-way decision left for later.
3. **A Clip's Recorder is still its own** (ADR 0036, decision 1). An OBS Clip (one with no Recording Session) plays, stills, transcribes, edits and exports from its own Footage as before. Its Footage is never moved or deleted by this.
4. **The seams stay.** The shared recording-session reducer (ADR 0050) still keeps the Recording Session's rules apart from the device, and the clip reducer still asks a `TakeSaver` for `save-takes` without knowing what saves them; each now has one implementation. The OBS-only branches in them are gone: a recording the Recorder cannot name, a Record the browser's gate refused, a Recorder released for the other one, a browser-set silence threshold and the browser's audio clock.

## Kept, on purpose

- The recorder parity script and the recorder scorecard: they read OBS numbers and Clips as evidence and run nothing of OBS.
- The Windows guard still refuses while OBS runs: a take can lose frames to any capture program, not only ours.
- `OBS_RECORDING_DIR`, where old OBS Footage lives, for `cvm footage list`.
- The CVM recorder's look and sound still copy OBS's (scene layouts, colour, the 3-band mic EQ): OBS was the reference, and old OBS Clips sit beside new ones in one export.

## Consequences

- ADR 0036's "the Video's Recorder means opens next" and ADR 0037's per-format Recorder choice no longer apply: there is nothing to choose.
- ADR 0044's adapter now adapts onto the clip reducer's own logic; there is no OBS path beside it.
- Bringing OBS back would mean restoring the connector, its saver and the picker from history; the data they need is still there.
