---
status: accepted
---

# One recording-session reducer, two effect sets

Decided by Matt on 2026-10-15 (#2196, #2200). Extends [ADR 0044](0044-the-cvm-recorder-is-an-adapter-onto-obs-clip-logic.md).

## Context

ADR 0044 shared the clip reducer between the Recorders, but not what turns each Recorder's signals into clip events. OBS had its connector, a speech detector, a route `useEffect` and two watch hooks. The CVM recorder had `cvmRecorderReducer`. The two shared no code, and their rules drifted apart: OBS stopped a take on every websocket reconnect, threw on events it did not expect, and left a take's audio window open when Stop came mid-speech. Matt: "I want especially that reducer to be almost exactly the same, except maybe just have different effects that it pings off."

## Decision

1. **One pure reducer owns the Recording Session as the editor follows it** (`recorder-session-reducer.ts`). It owns the phase, the Recording Session followed and those already over, the speech (`speechDetectorReducer`), Attaching, Stop, the gate's decision and the clip effects (`start-session`, `stop-session`, `start-take`, `close-take-window`).
2. **Each Recorder keeps only its device.** `obsConnectorReducer` keeps the websocket connection and the gate's calibration check. `cvmRecorderReducer` keeps the camera, scenes, screen, frames lost and where a Take saves. Each turns its signals into the shared reducer's events, and carries out its effects in its own hook.
3. **One policy for both Recorders:**
   - A reconnect never stops a Take. It re-attaches to the Recording Session followed (#2198).
   - The first report a page hears of a recording it does not follow stops that recording. A page refreshed or closed mid-take left it going. OBS cannot name the recording it reports on connect, so it stops one it never saw start on any connect.
   - Leaving the page (a refresh, closing the tab, or leaving the editor) asks the Recorder to stop (`useStopRecordingOnLeave`), as the CVM recorder already did (#2185).
   - A Recording Session's end mid-speech closes the take's audio window, as the silence after it would have.
   - Unexpected events are ignored, never thrown. A late event of a Recording Session not followed is expected (#2163) and is ignored quietly. An event a device cannot send in its state is logged (`log-unexpected`).

## Consequences

- Nothing changes how OBS or the recorder service writes files.
- OBS names the Recording Session it follows by its file and the time it started, because OBS may reuse a file name.
- While OBS's websocket is down mid-take, the Recording Session goes on, so its speech still shows Takes.
