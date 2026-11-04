# Recorder scorecard

Run 2026-11-04T04:06:21.474Z, full mode, commit `584bfdd4`, 1082 s. Long take 360 s; 50 Record/Stop cycles. Synthetic sources only (lavfi through the real ffmpeg.exe and the real recorder service).

The bar is the stricter of the target and OBS's value (CVM must be at least as good as OBS). Gap is how far past the bar, in each metric's own scale, so gaps rank across units.

## Gaps, worst first (12 failing, 22 unmeasured, 36 passing)

| #   | Metric                                                                                  | CVM      | Target  | OBS     | Bar     | Status   | Gap   |
| --- | --------------------------------------------------------------------------------------- | -------- | ------- | ------- | ------- | -------- | ----- |
| 1   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)              | 287 ms   | 100 ms  | unknown | 100 ms  | **fail** | 18.7  |
| 2   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)     | 510 ms   | 100 ms  | unknown | 100 ms  | **fail** | 12.42 |
| 3   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`) | 498 ms   | 250 ms  | unknown | 250 ms  | **fail** | 4.96  |
| 4   | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                      | 63.36 pp | 45 pp   | 42.7 pp | 42.7 pp | **fail** | 4.13  |
| 5   | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                            | 2.31 %   | 2 %     | 0.31 %  | 0.31 %  | **fail** | 4     |
| 6   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)           | 109 ms   | 70 ms   | unknown | 70 ms   | **fail** | 3.9   |
| 7   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                    | 105 ms   | 70 ms   | unknown | 70 ms   | **fail** | 3.5   |
| 8   | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                 | 1334 ms  | 1000 ms | unknown | 1000 ms | **fail** | 3.34  |
| 9   | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                   | 209 ms   | 100 ms  | unknown | 100 ms  | **fail** | 3.3   |
| 10  | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                          | 13.2 ms  | 10 ms   | 0.3 ms  | 0.3 ms  | **fail** | 2.58  |
| 11  | Memory growth across the cycles (`cycles_memory_growth_mb`)                             | 33.12 MB | 20 MB   | unknown | 20 MB   | **fail** | 1.31  |
| 12  | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                  | 1.09 s   | 1 s     | unknown | 1 s     | **fail** | 0.18  |

## All metrics

### Speed

| #   | Metric                                                                                                                      | CVM      | Target  | OBS     | Bar     | Status     | Gap   |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------- | ------- | ---------- | ----- |
| 1   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)                                                  | 287 ms   | 100 ms  | unknown | 100 ms  | **fail**   | 18.7  |
| 2   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)                                         | 510 ms   | 100 ms  | unknown | 100 ms  | **fail**   | 12.42 |
| 3   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`)                                     | 498 ms   | 250 ms  | unknown | 250 ms  | **fail**   | 4.96  |
| 4   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)                                               | 109 ms   | 70 ms   | unknown | 70 ms   | **fail**   | 3.9   |
| 5   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                                                        | 105 ms   | 70 ms   | unknown | 70 ms   | **fail**   | 3.5   |
| 6   | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                                                       | 209 ms   | 100 ms  | unknown | 100 ms  | **fail**   | 3.3   |
| 7   | Chat Highlight click to on screen, slowest click (service gets it → card's first visible frame) (`card_click_to_screen_ms`) | —        | 1000 ms | unknown | 1000 ms | unmeasured |       |
| 8   | Record press → recorder says recording (`record_ack_ms`)                                                                    | 34.93 ms | 100 ms  | unknown | 100 ms  | pass       |       |
| 9   | Record press → first camera frame in camera.mkv (`record_to_first_camera_frame_ms`)                                         | -5 ms    | 100 ms  | unknown | 100 ms  | pass       |       |
| 10  | Record press → first mic sound in mic.mkv (`record_to_first_mic_ms`)                                                        | 35.6 ms  | 100 ms  | unknown | 100 ms  | pass       |       |
| 11  | Stop press → recorder open again (UI unlocked) (`stop_to_open_ms`)                                                          | 1.4 ms   | 500 ms  | unknown | 500 ms  | pass       |       |
| 12  | Stop press → next command answered (`stop_to_next_command_ms`)                                                              | 2.08 ms  | 500 ms  | unknown | 500 ms  | pass       |       |
| 13  | Stop press → take files finalised (recording-stopped) (`stop_to_files_final_ms`)                                            | 894 ms   | 1000 ms | unknown | 1000 ms | pass       |       |
| 14  | Screen preview latency, idle (median) (`preview_screen_idle_p50_ms`)                                                        | 51 ms    | 70 ms   | unknown | 70 ms   | pass       |       |
| 15  | Screen preview latency, during a take (median) (`preview_screen_take_p50_ms`)                                               | 61 ms    | 70 ms   | 89 ms   | 70 ms   | pass       |       |
| 16  | Screen preview latency, during a take (p95) (`preview_screen_take_p95_ms`)                                                  | 97 ms    | 100 ms  | 111 ms  | 100 ms  | pass       |       |
| 17  | Longest camera preview gap around Stop (`preview_gap_on_stop_ms`)                                                           | 98.45 ms | 100 ms  | unknown | 100 ms  | pass       |       |
| 18  | Longest screen preview gap around Record (`screen_preview_gap_on_record_ms`)                                                | 74.23 ms | 100 ms  | unknown | 100 ms  | pass       |       |
| 19  | Clip end delay (silence long enough → speech-ended heard) (`clip_end_delay_ms`)                                             | 45 ms    | 250 ms  | unknown | 250 ms  | pass       |       |

### Reliability

| #   | Metric                                                                                                                                            | CVM      | Target   | OBS      | Bar      | Status     | Gap  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | -------- | -------- | ---------- | ---- |
| 1   | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                                                                           | 1334 ms  | 1000 ms  | unknown  | 1000 ms  | **fail**   | 3.34 |
| 2   | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                                                                                    | 13.2 ms  | 10 ms    | 0.3 ms   | 0.3 ms   | **fail**   | 2.58 |
| 3   | Memory growth across the cycles (`cycles_memory_growth_mb`)                                                                                       | 33.12 MB | 20 MB    | unknown  | 20 MB    | **fail**   | 1.31 |
| 4   | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                                                                            | 1.09 s   | 1 s      | unknown  | 1 s      | **fail**   | 0.18 |
| 5   | Stills (a placed Take's last and first frame) decoded from the growing files mid-take (`stills_decoded_mid_take`)                                 | —        | 0 stills | unknown  | 0 stills | unmeasured |      |
| 6   | Stills asked for mid-take: camera.mkv frames lost (`stills_take_camera_frames_lost`)                                                              | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 7   | Camera frames the service reports lost in a streamed Recording Session (`streamed_camera_frames_lost`)                                            | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 8   | Screen frames the service reports lost in a streamed Recording Session (`streamed_screen_frames_lost`)                                            | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 9   | Live Stream's average frame rate over the whole take: distance from 60.0 fps (`stream_take_fps_off_60`)                                           | —        | 0.05 fps | unknown  | 0.05 fps | unmeasured |      |
| 10  | Live Stream frames duplicated (the whole take, every process) (`stream_dup_frames`)                                                               | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 11  | Live Stream frames dropped (the whole take, every process) (`stream_drop_frames`)                                                                 | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 12  | Longest the Live Stream's encode ran under 0.9x real time (its health's speed), once steady and outside the faults (`stream_low_speed_max_s`)     | —        | 5 s      | unknown  | 5 s      | unmeasured |      |
| 13  | Sink dropped and back mid-take: the Live Stream reconnects inside its process (`stream_back_after_sink_drop`)                                     | —        | yes      | unknown  | yes      | unmeasured |      |
| 14  | Stream process killed mid-take: launched again, and live onto a new sink (`stream_back_after_kill`)                                               | —        | yes      | unknown  | yes      | unmeasured |      |
| 15  | Feeds lost mid-take (the stream frozen 8 s, past its stall): reconnecting, launched again, live onto a new sink (`stream_back_after_feed_cut`)    | —        | yes      | unknown  | yes      | unmeasured |      |
| 16  | Live Stream feed overflows ("FIFO queue full" in the camera writer's and screen recorder's logs) (`stream_feed_overflows`)                        | —        | 0 lines  | unknown  | 0 lines  | unmeasured |      |
| 17  | Live Stream inputs ended mid-take ("File ended prematurely") (`stream_input_eofs`)                                                                | —        | 0 lines  | unknown  | 0 lines  | unmeasured |      |
| 18  | [error]/[fatal] lines from the take's ffmpeg processes and the Live Stream, outside the faults (`stream_ffmpeg_error_lines`)                      | —        | 0 lines  | unknown  | 0 lines  | unmeasured |      |
| 19  | Longest gap in the sinks' sound (between packets, or its end short of the picture's) (`stream_sink_audio_gap_max_ms`)                             | —        | 100 ms   | unknown  | 100 ms   | unmeasured |      |
| 20  | Longest the camera stood still in the sinks' copies (each process's first 3 s left out) (`stream_sink_camera_still_max_s`)                        | —        | 0.5 s    | unknown  | 0.5 s    | unmeasured |      |
| 21  | Card server stalled 8 s mid-take: the stream is never relaunched, its click is refused, the next is drawn (`stream_unmoved_by_card_server_stall`) | —        | yes      | unknown  | yes      | unmeasured |      |
| 22  | Chat Highlight frames out of step: the card's opacity moving the wrong way, or before its stamp (`card_opacity_wrong_frames`)                     | —        | 0 frames | unknown  | 0 frames | unmeasured |      |
| 23  | Disk full mid-take (`disk_full`)                                                                                                                  | —        | yes      | unknown  | yes      | unmeasured |      |
| 24  | Camera frames dropped in the long take (`camera_dropped_frames`)                                                                                  | 0 frames | 0 frames | unknown  | 0 frames | pass       |      |
| 25  | Camera frames repeated per 100 (long take) (`camera_repeated_per_100`)                                                                            | 0 /100   | 0.1 /100 | 0.1 /100 | 0.1 /100 | pass       |      |
| 26  | Screen frames dropped in the long take (`screen_dropped_frames`)                                                                                  | 0 frames | 0 frames | unknown  | 0 frames | pass       |      |
| 27  | Screen frames repeated per 100 (long take) (`screen_repeated_per_100`)                                                                            | 0 /100   | 0.1 /100 | unknown  | 0.1 /100 | pass       |      |
| 28  | Frames the service itself reports lost (long take) (`service_frames_lost`)                                                                        | 0 frames | 0 frames | unknown  | 0 frames | pass       |      |
| 29  | Screen frames the service itself reports lost (long take) (`service_screen_frames_lost`)                                                          | 0 frames | 0 frames | unknown  | 0 frames | pass       |      |
| 30  | Screen lag drift across the long take (`screen_lag_drift_ms`)                                                                                     | 6.67 ms  | 10 ms    | unknown  | 10 ms    | pass       |      |
| 31  | Service killed mid-take: files playable (`crash_files_playable`)                                                                                  | 3 of 3   | 3 of 3   | unknown  | 3 of 3   | pass       |      |
| 32  | Service killed mid-take: take recovered on restart (`crash_take_recovered`)                                                                       | yes      | yes      | unknown  | yes      | pass       |      |
| 33  | Service killed mid-take: restart → recovered (`crash_recovery_ms`)                                                                                | 4783 ms  | 15000 ms | unknown  | 15000 ms | pass       |      |
| 34  | Preview killed → recording unaffected: pass rate over the runs (`preview_kill_pass_rate_pct`)                                                     | 100 %    | 100 %    | unknown  | 100 %    | pass       |      |
| 35  | Writer reconnect at Stop: capture lives through it (pass rate over the cycles) (`stop_capture_survival_pct`)                                      | 100 %    | 100 %    | unknown  | 100 %    | pass       |      |
| 36  | Camera capture process restarts per Stop (`capture_restarts_per_stop`)                                                                            | 0 /stop  | 0 /stop  | unknown  | 0 /stop  | pass       |      |
| 37  | Preview killed mid-take: camera.mkv frames lost (worst run) (`preview_kill_take_frames_lost`)                                                     | 0 frames | 0 frames | unknown  | 0 frames | pass       |      |
| 38  | Preview killed mid-take: every run carries on and stops cleanly (`preview_kill_take_ok`)                                                          | yes      | yes      | unknown  | yes      | pass       |      |
| 39  | Preview killed: kill → preview frames again (median run) (`preview_kill_recovery_ms`)                                                             | 1842 ms  | 3000 ms  | unknown  | 3000 ms  | pass       |      |
| 40  | Back-to-back Record/Stop cycles that failed (`cycles_failed`)                                                                                     | 0 cycles | 0 cycles | unknown  | 0 cycles | pass       |      |
| 41  | ffmpeg.exe processes left over after the cycles (`cycles_leaked_processes`)                                                                       | 0 procs  | 0 procs  | unknown  | 0 procs  | pass       |      |
| 42  | Cycles: Record press → recording (p90) (`cycles_record_ack_p90_ms`)                                                                               | 42.82 ms | 150 ms   | unknown  | 150 ms   | pass       |      |
| 43  | Event log write fails mid-take: take stops with playable files (`event_log_failure_stops_cleanly`)                                                | yes      | yes      | unknown  | yes      | pass       |      |

### Resources

| #   | Metric                                                                                     | CVM      | Target  | OBS     | Bar     | Status     | Gap  |
| --- | ------------------------------------------------------------------------------------------ | -------- | ------- | ------- | ------- | ---------- | ---- |
| 1   | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                         | 63.36 pp | 45 pp   | 42.7 pp | 42.7 pp | **fail**   | 4.13 |
| 2   | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                               | 2.31 %   | 2 %     | 0.31 %  | 0.31 %  | **fail**   | 4    |
| 3   | GPU utilisation while streaming and recording (nvidia-smi, average) (`gpu_streaming_pct`)  | —        | 85 %    | unknown | 85 %    | unmeasured |      |
| 4   | NVENC utilisation while streaming and recording (average) (`nvenc_streaming_pct`)          | —        | 90 %    | unknown | 90 %    | unmeasured |      |
| 5   | Recorder CPU, open and idle (% of machine) (`cpu_idle_pct`)                                | 1.72 %   | 2 %     | unknown | 2 %     | pass       |      |
| 6   | Recorder memory, recording (ffmpeg.exe working sets + service RSS) (`memory_recording_mb`) | 1176 MB  | 1500 MB | unknown | 1500 MB | pass       |      |
| 7   | GPU utilisation added by recording (vs before the service) (`gpu_recording_delta_pct`)     | 41.58 pp | 50 pp   | unknown | 50 pp   | pass       |      |
| 8   | GPU memory added by recording (`vram_recording_delta_mb`)                                  | 877 MB   | 1700 MB | unknown | 1700 MB | pass       |      |

## OBS evidence

- `nvenc_recording_delta_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS NVENC avg 42.7% (whole GPU)
- `cpu_recording_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS process avg 0.31% of 32 logical CPUs (CPU was waived by Matt in #1993)
- `av_drift_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS audio − camera trend 0.3 ms over 30 min
- `preview_screen_take_p50_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS Virtual Camera screen path p50 89 ms, recording
- `preview_screen_take_p95_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): p95 111 ms
- `camera_repeated_per_100`: ADR 0042: OBS repeats about 0.1 per 100 at 1080p59.94 (real Cam Link)

Every other OBS value is unknown: the repo has no measurement of it (no OBS start/stop latency, finalisation time, idle preview latency, crash recovery, cycle or disk-full data).

## Notes

- `nvenc_recording_delta_pct`: OBS's figure is the whole GPU while OBS recorded the real rig.
- `cpu_recording_pct`: Includes generating the synthetic sources. Matt waived CPU in #1993.
- `preview_gap_on_record_ms`: OBS: prose only (its preview never reopens).
- `av_drift_ms`: Absolute change from the first minute to the last.
- `stills_decoded_mid_take`: Each read the growing camera.mkv: two placed 6 s apart cost a streamed Recording Session 14 camera frames. Every still must be held until Stop. Details: `stillsMidTake.asked`.
- `stills_take_camera_frames_lost`: The service's framesLost plus the frames missing by index. Footage is on WSL's disk, not /mnt/d, so a decode that runs may lose none here.
- `stream_take_fps_off_60`: Decided 2026-10-31, for smoothness: frames the encoder put out per second of the Windows clock, one least-squares slope across every stream process once steady (the first from 20 s after live to its kill, sink drop included; the relaunched one from 5 s after live to End Stream). Latency wander is not a bar: the first process's lag is `streamed.streamLag` in the details, the rate `streamed.streamFps`. The relaunched process alone is reported, never a bar (decided 2026-10-31: over its short span the slope reads lag wander): `streamed.faults.relaunchedFpsOff60`, `relaunchedFps` and `relaunchedLag`.
- `stream_low_speed_max_s`: #2631: on 2026-11-03 Local Whisper held the GPU through a stream and its speed read 0.10-0.63 (clean ~0.99). Read over the same steady spans as the frame rate (the first process from 20 s after live to its kill, the relaunched one from 5 s after live to the feed cut), from the first health under 0.9 to the first back up (`stream-speed.ts`).
- `stream_back_after_sink_drop`: Reconnecting heard, live again once the sink listens again, no relaunch, and the new sink got frames. Details: `streamed.faults.sinkDrop`.
- `stream_back_after_kill`: Details: `streamed.faults.kill`.
- `stream_feed_overflows`: Each drops up to a queue of picture or sound. The real take had 101.
- `stream_sink_camera_still_max_s`: The synthetic camera's frame-index blocks change every few frames, so any stretch standing still is a frozen feed. Each process's picture starts a little before its feeds reach it: up to 3 s still at a sink's start is reported (`cameraStillAtStartS`), not counted.
- `gpu_streaming_pct`: Synthetic sources at Idle priority; the real take read 99% (README).
- `nvenc_streaming_pct`: The spec's budget is 85-90%; the real take read 79% median, 98% p95.
- `card_click_to_screen_ms`: Per click, the service's stamp of the card's first changed frame less when its show-highlight arrived: the card server's still, its decode, and the wait for the next frame. Every click is `chatHighlights.clickToScreenMs` in the details.
- `stream_unmoved_by_card_server_stall`: SIGSTOP on the card server, then SIGCONT (`card-checks.ts`). The take-wide rate, dups and drops above include the stall. Details: `chatHighlights.cardServerStall`.
- `card_opacity_wrong_frames`: Read off the sink's copy of the stream, from the card's accent bar, around every edge of the scripted clicks (`card-checks.ts`). The spike saw 13 early frames in 17 clicks.
- `disk_full`: Not simulated: a size-limited or throttled filesystem needs root, and the footage drive must never be filled.
- `stop_to_files_final_ms`: OBS: the rig only bounds it (StopRecord → file stable ≤ 8 s, including a 5 s settle wait): not a measurement.
- `cpu_idle_pct`: Includes generating the synthetic sources (lavfi, geq) inside the capture processes.
- `gpu_recording_delta_pct`: Whole-GPU reading less the reading before the service started; anything else on the GPU moves it.
- `vram_recording_delta_mb`: OBS's rig run used 1662 MiB of VRAM on the whole GPU (not a delta), so it is not a reference here.
- `camera_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `camera_repeated_per_100`: The synthetic camera never repeats a frame itself; the real Cam Link at 4K does (ADR 0042, ~11 per 100).
- `screen_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `preview_kill_pass_rate_pct`: A run passes when the take stops cleanly on request with no frame of camera.mkv lost.
- Footage is written to WSL's own disk (ffmpeg.exe reaches it over \\wsl.localhost), never to a Windows drive; Matt's footage goes to a Windows drive, so finalisation times here include the WSL file share.
- A/V drift is measured over the long take (360 s, real time), first minute against last.
- Every Windows process ran through the Windows guard (Idle priority, cores 6-9), checked every 5 s; timer-resolution.ps1 was not run (it raises the capture, writer and screen recorder to High).
- GPU before the service started: 0% busy, NVENC 0%, 1295 MiB.
- Merged from 3 runs (--only, each one service start, in order): idle, longTake; previewKill, eventLogFailure, crash; cycles. Full-mode cycles and fault repeats; the long take is 360 s, not 600 s, so each part fits an agent's 600 s foreground limit.
- Camera preview latency (idle and take p95, the gaps around Record and Stop) read within this night's main-vs-main spread: two runs of ce798710 read take p95 173 and 321 ms and idle p95 365 and 534 ms, and 50 Records' preview gaps had the same distribution on main and on this branch (#2442). The probe's software canvas makes these tails noisy (#2440). The idle and long-take part ran on the working tree that was then committed as this commit, unchanged.
