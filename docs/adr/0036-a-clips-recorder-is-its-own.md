---
status: accepted
---

# A Clip's Recorder is its own; the Video's Recorder means "opens next"

> Decision 2 (the Video's Recorder) is superseded by [ADR 0051](0051-the-cvm-recorder-is-the-only-recorder.md): every Video records with the CVM recorder. Decision 1 stands.

Decided by Matt on #1993.

## Context

A **Video** chose its **Recorder** (`video.recorder`: OBS or the CVM recorder) and the choice locked once it had a live **Clip**, so one Video never mixed OBS and CVM-recorder Clips. Archiving every Clip unlocked it, and restoring an archived Clip filmed with the other Recorder was refused (`clipRestoreRefusal`).

The lock was policy only. Everything that reads Footage already works per Clip, from whether it has a **Recording Session** (`clipRecorder`): the export and its **Export Hash**, the **Mic EQ** and mic offset, the **Scene Override**, **Clip Zoom**, **Overlays**, copies and the footage CLI. The only per-Video reads mean "which Recorder opens next": Record and its guard, the OBS connector and its profile check, Stream Deck routing and the thumbnail camera.

## Decision

1. **A Clip's Recorder is its own** (`clipRecorder`: a Recording Session means the CVM recorder). One Video may hold OBS and CVM-recorder Clips, and its export draws each from its own Footage.
2. **The Video's Recorder only says which Recorder opens next** in the editor. It can be switched at any time except while capturing: the editor disables the picker mid-capture, and `updateVideoRecorder` refuses while one of the Video's Recording Sessions is still recording. A Video with Clips may switch.
3. **Deleted:** the Footage lock (`isRecorderLocked` and the "locked once the Video has Clips" refusal) and `clipRestoreRefusal`: any archived Clip restores.
4. ~~**Export to DaVinci Resolve** still refuses a Video holding any CVM-recorder Clip, because it hands DaVinci one Footage file per Clip and a CVM-recorder Clip's picture is a composite of three files. It no longer looks at the Video's Recorder.~~ Superseded by ADR 0039: the export is deleted.
5. **No schema change.** `video.recorder` keeps its column and values.

## Consequences

- Mic EQ drift between an OBS Clip (EQ baked in by OBS) and a CVM-recorder Clip on the same Video is accepted; there is no guard. Matching their pictures is out of scope.
- A Video can be started in OBS and finished on the CVM recorder (or back) without archiving anything.
- Tested once end to end (`recorder-client-mixed-video.test.ts`): a Video with an OBS Clip switches to the CVM recorder, records through the recorder service with its scripted ffmpeg.exe, and its export draws both Clips.
