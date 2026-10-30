---
status: accepted
---

# The Live Stream is its own process, fed by the Recording Session's writers

Decided on 2026-10-30 (spec #2445, built in #2452). It extends [ADR 0047](0047-the-recorder-holds-its-devices-open.md) points 4 and 5.

## Context

Matt wants to go live on YouTube from the CVM recorder, with everything that goes out also recorded ("I always want to record everything that goes out on stream"). He wants true 1080p60, never 30, and no extra processes while he isn't streaming, which is most of the time.

A rig test (2026-10-30) pushed a 1080p60 NVENC composite from a separate ffmpeg.exe while recording, with 0 recording frames lost. On real devices, a stream that read the screen preview logged about 10 duplicated frames a second: the preview's ddagrab skips slots once a take's GPU work starts. A synthetic run that read the screen recorder's own packets had 60.0 fps, 0 dups and 0 drops (`live-streaming-feasibility.md`, true-60).

## Decision

1. **The Live Stream is one ffmpeg.exe of its own** (`stream-side.ts`, tagged `cvm-recorder-stream`). It holds no device and writes no file. It draws every Landscape scene on CUDA from the scene layout's `drawInstructions` and picks one with `streamselect` (`liveSceneFilterGraph`). It encodes 1920x1080 at 60 fps CFR on NVENC (CBR 9 Mbps, a keyframe every 2 s, AAC 160k) and pushes to YouTube's RTMPS ingest behind a fifo that retries without limit. Every setting is a constant in code.

   Its sound is the export's, live (#2458): Mic Offset → Mic EQ (the export's own filter, `app/packages/mic-eq`) → a static `STREAM_GAIN_DB` (+16 dB, beside the preview's boost) → `alimiter` at −2 dBFS with `latency=1` and `level=0` → AAC. That lands a real take near the export's −16 LUFS (measured −16.7 against the export's −16.4 on the same take). There is no `loudnorm`, `dynaudnorm` or compressor: `loudnorm` holds 3 s of audio, and the others change the sound. The Mic Offset and Mic EQ are read once at Go Live and ride in `start-stream`. The chain runs only in the stream process, so mic.mkv stays raw.

2. **It is fed by the streamed Recording Session's own processes, only while it records.** Go Live arms the take's camera writer again as a streamed writer (`streamed` in its settings), starts the stream listening, then records:
   - the camera writer gets a second output: the very frames and sound camera.mkv and mic.mkv get, raw, in Matroska with their stamps kept;
   - the screen recorder writes through a tee: screen.mkv as before, plus a CPU copy of the same encoded packets, which the stream decodes on NVDEC. It is never a second GPU stream (ADR 0047 point 5). The tee needs `-flags +global_header`, or Matroska refuses its header and screen.mkv gets no frames.

   The long-lived capture and previews never change, and every other Recording Session runs today's args exactly.

3. **Raw footage first.** Every feed sits behind tee's fifo, which drops when full and ignores failure. Record waits for the stream to be listening only `STREAM_LISTEN_BOUND_MS` (1.5 s), and records anyway past it. Nothing the stream side does stops a take, releases the camera or restarts a preview. A stream process that quits only ends the Live Stream, with its reason; the take carries on until End Stream. Relaunching it is #2459.
4. **A Live Stream always has its Recording Session.** End Stream stops both, the last Take let go as Stop lets it go (ADR 0048). The streamed Recording Session ending in any other way (Stop, the camera lost, a process quitting) ends the Live Stream, saying why.
5. **The Stream Key is read from `.env` at Go Live** with the repo's own parser, never from an inherited environment variable, and held as `Redacted`. It travels only in `start-stream` over loopback and appears only on the stream process's command line. The stream's stderr, the service's log of an unreadable command, every refusal, `events.jsonl` and the service's state folder are kept free of it.

6. **Chat Highlights ride in the same process, as a third input** (#2461). The service's card feed (`card-feed.ts`, Node) listens on a WSL loopback port; the stream reads it as raw yuva420p at 60 fps, uploads it and draws it with `overlay_cuda` at a fixed place after `streamselect`. Frame n is picture time n/60 (the frame count is the stamp, under `-copyts`), on the canvas's own grid, never arrival time. The feed sends a frame once the recorder's clock reaches it, the same frame again while nothing moves, and waits (never skips) while the stream is slow to read; its input ending leaves the picture as it is (`eof_action=pass`). The card's still comes from the overlay renderer's card server (Chromium with software GL, at the lowest priority), started once the stream is live, never per frame. Each edge is stamped with the frame it first changes and logged in the streamed Recording Session, which closes one still showing at its stop.

## Consequences

- A streamed take's screen.mkv is muxed through a tee with global headers. The synthetic scorecard showed framesLost 0 for camera and screen (120 s, with the sink and then the stream process killed mid-take). A real-device take must confirm it before shipping (#2463).
- `overlay_cuda` copies its base into a frame from the base's own pool, and `scale_cuda`'s pool is 32-row aligned. A scene drawn on the screen came out 1920x1088 (ffmpeg 8.0.1, measured). So every scene is drawn on one black canvas uploaded once a frame, which also clocks every scene at exactly 60 fps; the screen's whole-millisecond stamps are put on that grid. With both, the stream measured 60.1 fps, 0 dups and 0 drops on the synthetic rig.
- All three scenes are drawn every frame, so a scene switch (#2457) is a runtime `streamselect` command and never restarts the stream. The stream side follows the service's own scene: each switch, from the editor or the Stream Deck, writes `Cstreamselect -1 map <n>` to the stream process's stdin (the writer's T0 mechanism, sent now rather than queued, as the graph runs on the canvas's clock). ffmpeg reads its stdin once a stats period, so the stream's is 0.05 s. On the synthetic rig (ffmpeg 8.0.1) each switch was applied 47-117 ms after it was sent, with 60.1 fps, 0 dups and 0 drops.
- Go Live is refused, with every reason that applies, for a Short, while recording, with the camera not live, or while the screen preview has fallen back to the CPU encoder. The app server adds a missing Broadcast, a Broadcast YouTube won't auto-start or auto-stop, a missing Stream Key, no YouTube stream whose ingest name is the Stream Key, and a stale AV Calibration.
- Once nothing refuses, the app server binds the picked Broadcast to the Stream Key's YouTube stream if it is unbound or bound to another (#2456). The key is matched in memory against `liveStreams.list`'s ingest names, never sent to YouTube or logged. CVM never calls the Broadcast transition API.
- RTMPS was not tried on the rig; the spike pushed plain RTMP. The first real Go Live is its test.
- A Chat Highlight's still takes about half a second to draw, so a click reaches the picture in 0.55-0.77 s on the synthetic rig (12 clicks); a click in the first few seconds after going live waits for the card server to warm (about 3 s). Its browser is downloaded ahead (`browser:ensure`); Go Live is refused without it, so the ~109 MB download never happens live.
- The card frames on the picture are not yet always the ones of their slot: the synthetic rig showed 15 frames out of step in 20 clicks, both earlier and later states of the card, with exact stamps on both sides. #2462 diagnoses it.
