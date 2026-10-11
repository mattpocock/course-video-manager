# OBS-free recorder rig: how to run it

**Start here** (WSL; uses the dedicated worktree `~/repos/matt/obs-rig-test`, not your CVM checkout):

```
cd ~/repos/matt/obs-rig-test/spikes/obs-free-recorder && git pull --ff-only && ./wizard.sh
```

`wizard.sh` runs the whole test **unattended**, about 1 h 25 min. It shows one screen: the preflight results (ffmpeg 8.0.1, `./rig check`, the DELL found by name, the Cam Link and the mic listed by name only, free disk, OBS and Chrome), then the one-time setup below. Press Enter and walk away. Nothing asks for anything after that. At the end it writes `SUMMARY.md` with every verdict and prints **Send Claude this path**. A Windows toast says when it's done.

**Before you press Enter (one-time setup):**

- **Point the camera (Cam Link) so the DELL fills at least a quarter of its view.** The camera has to see the white flash. Nobody sits in front of it, so the flash on your face doesn't count.
- **Speakers on, not headphones, Windows volume about 50%.** The mic has to hear the 1 kHz beep.
- **Leave OBS idle or closed, and don't film.** The wizard launches OBS, records with it, and closes it.
- **Don't touch the mouse or keyboard.** A fullscreen page takes over the DELL during the baseline and the record run.

There's no clapping. Lip sync is compared with OBS instead: see "Lip sync without a clap" below.

Progress is saved in `D:\obs-rig\wizard\state.env`. A failed step is recorded and the run carries on. Re-running resumes at the next unfinished step and never re-runs a finished one (`--redo N` repeats step N, `--fresh` starts over). Ctrl-C stops the recorders, and OBS's recording, cleanly, and leaves that step unfinished. `./wizard.sh --dry-run` walks every step with the recordings stubbed (no capture, no device, no page) and a mock OBS (`lib/mock-obs.ts`) instead of the real one. If the worktree is missing: `git -C ~/repos/matt/course-video-manager worktree add ~/repos/matt/obs-rig-test spike/obs-free-recorder`.

This is a spike for architecture (b): ffmpeg.exe records the camera, screen and mic to three separate files, and a browser page draws the preview. Run every command from WSL in this folder. Each run writes to `D:\obs-rig\runs\<time>-<mode>\` and ends by printing `report.md`, the verdict against the stop criteria.

ffmpeg must be **8.0.1** (`winget install Gyan.FFmpeg --version 8.0.1`). Versions 8.1 and 9.x need NVIDIA driver 610 or later for NVENC, and this machine has 591.74. It's pinned on this machine (`winget pin add --id Gyan.FFmpeg --version 8.0.1`, so `winget upgrade` skips it), and every mode refuses to start on any other version (`--any-ffmpeg` overrides that).

## What the wizard runs

| #   | Step               | Command               | OBS                  | Takes   |
| --- | ------------------ | --------------------- | -------------------- | ------- |
| 1   | Preflight          | (on the start screen) | not touched          | ~20 s   |
| 2   | Selftest           | `./rig selftest`      | not touched          | ~13 min |
| 3   | Baseline with OBS  | `./rig baseline`      | launched, records    | ~33 min |
| 4   | Close OBS          | `./rig obs close`     | closed, checked gone | ~1 min  |
| 5   | Record without OBS | `./rig record`        | must be gone         | ~33 min |
| 6   | Crash recovery     | `./rig crash`         | must be gone         | ~3 min  |

- **Selftest:** no device is opened: the camera and mic are synthetic. It records twice, once with a synthetic screen and once capturing the real screen (ddagrab), where a small black square in the DELL's top-left corner flashes white every 20 s. Then a 60 s kill -9 test.
- **The screen:** every mode records the monitor named `DELL U2424H` (`--screen-name`). `./rig screens` lists the outputs by name; nothing is captured. `--screen N` forces an index.
- **Baseline:** launches OBS if it isn't running, sets the `Landscape Recording` profile (as CVM does), the **Code** scene and the Virtual Camera, starts recording through obs-websocket, opens the page fullscreen on the DELL, records 30 min, stops, and takes the file from OBS's StopRecord reply.
- **Close OBS:** stops any recording and the Virtual Camera, then WM_CLOSE, then `taskkill` without `/F`, and a force-kill only as a last resort. Steps 5 and 6 check OBS is gone first, close it again if it came back, and fail the step if it won't go.
- **Record:** the page runs fullscreen on the DELL and does what your keys did: switches scene every 90 s, and 5 min in saves the ghost frame (T) and shows it for 30 s (G). It compares itself with the latest baseline automatically.
- **Windows stays awake** for the whole run (`lib/awake.ps1`): a display-and-system power request, a zero-distance mouse nudge every 30 s so no inactivity lock fires, and the screensaver, Dynamic Lock and the AC sleep, hibernate and display-off timeouts turned off. The original values are saved first and restored at the end, on Ctrl-C, or by the next run if the wizard was killed.

**How the rig finds OBS:** the same way CVM does (`apps/local/live-desk/live-desk.ts`). It uses `VITE_OBS_WEBSOCKET_URL` from the environment or the main checkout's `.env`, and otherwise `ws://localhost:4455`, with no password, as CVM's `obs-connector` connects. The calls go from Windows PowerShell (`lib/obs-ws.ps1`), because WSL is in NAT mode here and only Windows reaches OBS on localhost. `./rig obs url | status | launch | close` drives it by hand.

**The page** opens in a separate Chrome profile (`D:\obs-rig\chrome-kiosk`), fullscreen on the DELL, with sound allowed without a click and camera access without a prompt. Your own Chrome isn't touched. The page closes when the run ends.

`./rig analyze <runDir>` re-runs the analysis on any run. `./rig check` runs the verdict rules against known-bad and known-good cases in under a second. `./rig lipsync-proof` is the synthetic proof below.

## Lip sync without a clap

The clap was only ever read by eye from `clap-*.png`, to get the absolute lip sync. The verdicts never used it. Unattended, it's replaced by comparing with OBS. In both the baseline and the record run, the camera sees the same DELL flash and the mic hears the same speaker beep. The monitor's and the speakers' latencies are the same in both runs, so they cancel out. The difference between the two runs' median audio − camera offsets is the rig's lip sync relative to OBS today. That's the verdict **lip sync vs OBS**: within 33 ms plus one OBS canvas frame, because the OBS file only shows the camera at its 60 fps canvas ticks. The **lip sync drift** verdict (H2) needs no absolute value at all.

`./rig lipsync-proof` renders an OBS-style baseline and three rig runs from lavfi, with a camera that sees the DELL as a quarter of its view and a quiet beep in room noise. It then runs the real analysis on them. Lip sync 10 ms later than OBS passes. Lip sync 60 ms later than OBS fails. Audio drifting 0 to 60 ms fails the drift verdict.

Unattended runs also fail, rather than read n/a, when fewer than 3 markers land (the camera doesn't see the DELL or the mic doesn't hear the beep), or when the page never started with sound on.

## Page keys

Unattended, the page needs none of these. They still work if you're there: `1` Camera · `2` Code · `3` No Face · `M` marker · `F` flash and beep now · `T` end of take (saves the ghost frame) · `G` toggle the ghost overlay · `Q` stop

Scene switches and markers are saved with their file time in `events.jsonl`. The HUD shows the preview delay on two paths, both measured when the page has decoded a preview frame:

- **Screen path:** the page decodes its own on-screen millisecond clock (the black and white strip at the top left) out of the screen preview.
- **Camera path:** the time from each white flash until the camera preview brightens. It only works if the camera sees the flash.

Neither includes the page drawing the composite or the monitor's scan-out, about 1–2 frames more, so neither is full glass-to-glass.

## What to send back

The path the wizard prints at the end. It holds `SUMMARY.md` (every verdict), each run's `report.md`, `report.json`, `meta.json` and `events.jsonl`, and `wizard.log` (the whole console).

## Reading the report

- **Drift** is judged for three pairs: audio/screen, camera/screen, and audio/camera (lip sync). Each must have a linear trend over the run of 33 ms or less (steady drift), and every marker must sit within 33 ms of the run's median offset (jumps). The median itself is a fixed latency, which you calibrate once.
- **The camera's CFR saw-tooth is taken out before judging.** When the camera's clock runs fast or slow, the recording is kept at a constant frame rate by dropping or repeating a frame, so in the file the camera's offset ramps through up to one frame (33 ms) and snaps back, as in OBS. The rig logs every frame's arrival time before that step, so it can undo it at each marker. The last column of the marker table shows the raw file-time offset. The OBS baseline has no arrival times, so its camera pairs get one frame of extra room.
- **No dropped frames:** no frame lost for good on either file, and the screen must deliver 60 fps against the machine's clock (within 100 ppm). Both the screen and the camera are judged.
- **No capture stalls:** no gap over 100 ms between frames arriving after the first 3 s. A stall followed by a burst loses no frames by count, but the recording freezes and then drops the burst.
- **Recorder keeps up:** each ffmpeg's output time is compared with Windows time at every progress line, and the lag mustn't grow by more than 0.5 s.
- **Preview feeds deliver frames:** each preview feed must deliver its first frame within 10 s and never go quiet for 2 s. The preview connection retries every 0.5 s, so a slow first connect no longer loses the preview for the whole run.
- **kill -9 recovery:** each file must decode cleanly and end no more than 2 s before its own process was killed. The kill time is read on Windows inside the kill call. A killed MKV has no container duration, and CVM reads that field, so the rig remuxes each file in place (stream copy) and keeps the raw one as `*.killed.mkv`. The report shows both.
- **NVENC % from nvidia-smi is misleading.** It reads 99% even at preset p2 because the GPU clocks down when lightly loaded. Compare GPU and CPU against the baseline instead. A throughput test showed 1.58x real-time headroom at p5.

## Risks found while building it

- **Screen capture pacing (fixed).** ffmpeg paces ddagrab with `Sleep()` and waits for each desktop frame with an 8 ms `AcquireNextFrame` timeout. ffmpeg never raises the Windows timer resolution, and since Windows 10 2004 that resolution is per process, so both waits round up to the default 15.6 ms tick. When a slot's sleep wakes ~15 ms late and the timeout also takes ~15 ms, the slot is more than one frame late and ddagrab skips it. Those frames are lost for good: 59.5–59.9 fps, 14–89 frames short in 3 min. Whenever ddagrab captures, the rig now fixes the screen recorder right after it starts. `lib/timer-resolution.ps1` does three things to that ffmpeg.exe. It calls `timeBeginPeriod(1)` inside it, as libobs does for OBS in its `DllMain`. It opts the process out of power throttling, because otherwise Windows 11 sometimes ignores the 1 ms request for a window-less background process. And it sets the process to High priority, because the screen preview's second Desktop Duplication session still cost about 5 frames a minute at Normal. **Measured** in the selftest's real-screen phase: 59.649 fps and 63 short before, 60.000 fps and 0 lost after, and `./rig selftest` ends `SELFTEST PASS`. If the raise fails, the rig prints a WARNING and records it in `meta.json` (`screenTimerResolution`). `dup_frames=0` is still no option, because it delivers no frames at all while the screen is static, and that stalls the recorder. OBS doesn't skip either: it polls Desktop Duplication without waiting (`AcquireNextFrame(0)`) on its own render clock, a 1 ms-timer sleep plus a QPC spin, and reuses the last image when nothing changed. So it outputs 60 fps whatever the desktop does.
- **ddagrab and a second GPU stream don't share a process well.** Putting screen and camera in one ffmpeg.exe dropped the screen to 55–58 fps. That's why there are two recorder processes, plus a third for the screen preview. They share a clock through Windows wall time.
- **The real devices are untested here,** because the Cam Link and the mic were off-limits. These are untested assumptions: the Cam Link offers 4K NV12 over DirectShow, `-use_wallclock_as_timestamps` is accurate for DirectShow, and a 20 ms mic buffer works. The record and crash runs are the real test.
- **The WSL clock ran about 4% slow against Windows** on this machine. The rig never uses WSL time for anything it measures.
