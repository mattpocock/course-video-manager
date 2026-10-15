---
status: accepted
supersedes: 0046-the-recorder-preview-encodes-on-nvenc (decision 4 only)
---

# The recorder holds its devices open; Record only starts writing

Decided on 2026-10-14 (#2207), after Matt asked for parity with OBS: "Pressing record still takes a couple of seconds before the picture unfreezes and it's ready to record", and "the preview has to stay absolutely static and work exactly the same".

## Context

Record used to stop the camera preview process and start a camera + mic process for the take. The Cam Link and the mic closed and opened again. On Matt's rig that took 1.1 s to T0 (the hand-off alone was 1.0 s), then about 1 s more to the first camera frame. The mic's first 1.5 s were trimmed as warm-up. The preview froze for 1.5-2.5 s, and during a take it was camera.mkv's own stream, which was later than the idle preview. OBS keeps its devices open, so Record there only starts the muxer.

## Decision

1. **The Cam Link and the mic open once, when the recorder opens, in a camera capture process.** It encodes nothing. It sends the picture raw (1440p NV12, scaled on the GPU as before) over two loopback relays: one to the camera preview and one to the take's writer. The mic is anchored on its clock (`micAnchor`) in that process, from the moment it opens.
2. **The camera preview is one process for as long as the capture runs.** It has the same encoder and settings whether a take runs or not. Record and Stop never start or stop it.
3. **Each take's camera + mic writer is armed before Record.** It listens on the writer relay and drops every frame until Record writes T0 to its stdin (ffmpeg's queued `C` command). The command applies from the first frame stamped T0 or later, so camera.mkv starts at T0 to the frame. mic.mkv needs no warm-up trim. ~~Stop waits 250 ms for frames still in the relay, then quits it. The next writer is armed straight away.~~ Stop superseded by [ADR 0048](0048-stop-lets-the-take-go.md): the recorder is open again at the press, the writer quits once it has written past the press, and the next writer arms once the relay is free.
4. **Failures stay apart.** Each relay is behind tee's dropping, retrying fifo (Matroska for the writer and bare frames for the preview, not NUT, per [ADR 0048](0048-stop-lets-the-take-go.md)). The capture never waits on a consumer. A preview that dies, stalls or fails its encoder cannot stop or change camera.mkv. A writer that dies cannot freeze the preview. A frame the writer's relay drops shows as a gap that the writer logs, and the take reports it in `framesLost`, with where it fell in `lostFrameSpans`. The editor alerts only for a loss inside a Clip (#2227).
5. **The screen recorder stays one process per take.** The screen preview was always its own process, so Record never froze it. Desktop Duplication opens no device. Any second GPU stream in the screen recorder's process (an upload, scale, NVENC or read-back) cost ddagrab frames on the rig (#1992), so a raw screen relay was not tried.

## Consequences

- On the synthetic 1440p29.97 source with Windows ffmpeg 8.0.1, the first recorded frame is the frame at T0 (none repeated to fill a late start). The mic sounds from 24 ms. The camera preview's latency is the same idle and during a take: 50-74 ms median idle, 69 ms during a take, against 64 ms for the old preview-only process.
- ffmpeg's rawvideo encoder is frame-threaded and held every relay a whole frame. The relays run it on one thread (`-threads:v 1`). Their stamps keep the source's time base (`-enc_time_base:v filter`) rather than the frame rate's ticks.
- The mic is open whenever the recorder is open, so the level meter opens it a second time while both run.
- An armed writer's folder exists before Record. It is named for when it was armed, and is removed if no take uses it. A service that crashes while a writer is armed leaves that empty folder behind.
