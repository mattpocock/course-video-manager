---
status: accepted
---

# The CVM recorder is an adapter onto the OBS recorder's clip logic

> The OBS path is deleted by [ADR 0051](0051-the-cvm-recorder-is-the-only-recorder.md); the clip logic it describes stays, with the CVM recorder its only user.

Decided by Matt on 2026-10-14 (#2165), after #2151 and #2164. Amends the consequence in [ADR 0034](0034-recording-runs-in-its-own-recorder-service.md) on where the recorder client saves Clips. [ADR 0050](0050-one-recording-session-reducer-two-effect-sets.md) then moves what both Recorders send the clip reducer into one shared recording-session reducer.

## Context

The CVM recorder had its own clip placement: the app server held an **Insertion Point** per Video, moved it after each Clip it saved, and the editor told it whenever its own moved. #2151 then put a shared Take model in place of OBS's logic. Deleting a Clip mid-take left the two points disagreeing (#2163), and OBS's behaviour had changed under a refactor. Matt: "That logic is super solid and I'm really used to it."

## Decision

1. **OBS's clip logic is the reference and does all the placing**, as it was before #2151 (`clip-state-reducer-recording.ts`): Optimistic Clips, the Insertion Point, delete during a take, restore, and where saved Clips go.
2. **The CVM recorder is an adapter** (`cvm-recorder-reducer.ts`). It turns its own signals into the events OBS's connector, speech detector and polling send the clip reducer: a Recording Session followed starts and stops a session (`recording-started`, `recording-stopped`, then the same 10 s timeout), speech held for the minimum Clip length is `new-optimistic-clip-detected`, silence is `clip-audio-window-closed`, and its saved Clips are `new-database-clips`. The #2164 rule, that events of an old Recording Session are ignored, lives here.
3. **The editor owns the Insertion Point; the app server keeps none.** OBS's polling sends the editor's point, resolved to saved items, with each save. The CVM recorder does the same when a speech ends: the recorder client tells the editors `speech-ended` and waits for one to answer with its point (`POST /recorder/place-take`), saves there, and answers that editor with the Clips.
4. **A save never waits on an editor.** With no answer in 5 s (no editor open, a frozen tab, or none following that Recording Session), the speech is saved after the Video's last item and published as `clips-saved`. Every speech long enough is saved, with or without an editor.

## Consequences

- A CVM take that made no Clip is orphaned 10 s after Stop, as on OBS, not at once.
- With the editor closed mid-recording, Clips land at the end of the Video rather than where the editor last pointed.
- A Clip saved without an answer (the fallback) is shown in its take, but stored at the end of the Video until a reload shows it there.
