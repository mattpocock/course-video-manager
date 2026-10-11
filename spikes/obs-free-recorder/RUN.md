# OBS-free recorder rig: how to run it

**Start here** (WSL; uses the dedicated worktree `~/repos/matt/obs-rig-test`, not your CVM checkout):

```
cd ~/repos/matt/obs-rig-test/spikes/obs-free-recorder && git pull --ff-only && ./wizard.sh
```

`wizard.sh` runs the whole test **unattended**, about 1 h 25 min. It shows one screen: the preflight results (ffmpeg 8.0.1, `./rig check`, the DELL found by name, the Cam Link and the mic listed by name only, free disk, OBS and Chrome), a **QR code** for the phone video, then the one-time setup below. Press Enter and stay about a minute for the **camera and mic check**: if it fails, the wizard stops there and says what to change. Then walk away. Nothing asks for anything after that. At the end it writes `SUMMARY.md` with every verdict and prints **Send Claude this path**. A Windows toast says when it's done.

**The phone replaces the flash on the DELL for the camera.** The camera can't point at the DELL, so a phone in front of the camera plays a video from the rig: black, with a full-screen white flash and a 2 kHz beep every 10 s, 2.5 h long so it never loops. The rig builds it once with ffmpeg (`./rig phone`, cached in `D:\obs-rig\phone\`) and serves it on the LAN from Windows while the start screen shows (`./rig phone --serve`; WSL is in NAT mode, so a phone can't reach a server inside WSL).

**Before you press Enter (one-time setup):**

- **Phone propped close in front of the Cam Link, in the middle of the picture, its screen filling at least 1/4 of the image.** The middle matters: OBS's Code scene shows only the middle third of the camera, and the baseline has to see the flash too.
- **Phone: full brightness with Adaptive brightness off, volume about 2/3, plugged in.**
- **Download the video and tap play:** scan the QR code in Chrome on the phone (or type the URL under it), download, then open it in **Files by Google** and tap play. Same Wi-Fi as the PC. If Windows asks whether PowerShell may accept connections on private networks, click Allow.
- **PC speakers on, not headphones, Windows volume about 50%.** The mic has to hear the PC's 1 kHz beep.
- **OBS not recording, and don't film.** The wizard closes OBS for the camera and mic check, launches it for the baseline, and closes it again.
- **Don't touch the mouse or keyboard.** A fullscreen page takes over the DELL during the check, the baseline and the record run.

There's no clapping. Lip sync is compared with OBS instead: see "Lip sync without a clap" below.

Progress is saved in `D:\obs-rig\wizard\state.env`. A failed step is recorded and the run carries on, except the camera and mic check, which stops the wizard. Re-running resumes at the next unfinished step and never re-runs a finished one (`--redo N` repeats step N, `--fresh` starts over). Ctrl-C stops the recorders, and OBS's recording, cleanly, and leaves that step unfinished. The camera and mic check runs again on every start while a step that uses the camera is unfinished, because the phone may have moved. `./wizard.sh --dry-run` walks every step with the recordings and the check stubbed (no capture, no device, no page), the phone video served on 127.0.0.1 only, and a mock OBS (`lib/mock-obs.ts`) instead of the real one. If the worktree is missing: `git -C ~/repos/matt/course-video-manager worktree add ~/repos/matt/obs-rig-test spike/obs-free-recorder`.

This is a spike for architecture (b): ffmpeg.exe records the camera, screen and mic to three separate files, and a browser page draws the preview. Run every command from WSL in this folder. Each run writes to `D:\obs-rig\runs\<time>-<mode>\` and ends by printing `report.md`, the verdict against the stop criteria.

ffmpeg must be **8.0.1** (`winget install Gyan.FFmpeg --version 8.0.1`). Versions 8.1 and 9.x need NVIDIA driver 610 or later for NVENC, and this machine has 591.74. It's pinned on this machine (`winget pin add --id Gyan.FFmpeg --version 8.0.1`, so `winget upgrade` skips it), and every mode refuses to start on any other version (`--any-ffmpeg` overrides that).

## What the wizard runs

| #   | Step                 | Command               | OBS                  | Takes   |
| --- | -------------------- | --------------------- | -------------------- | ------- |
| 1   | Preflight            | (on the start screen) | not touched          | ~20 s   |
| 2   | Camera and mic check | `./rig preflight`     | must be gone         | ~1 min  |
| 3   | Selftest             | `./rig selftest`      | not touched          | ~13 min |
| 4   | Baseline with OBS    | `./rig baseline`      | launched, records    | ~33 min |
| 5   | Close OBS            | `./rig obs close`     | closed, checked gone | ~1 min  |
| 6   | Record without OBS   | `./rig record`        | must be gone         | ~33 min |
| 7   | Crash recovery       | `./rig crash`         | must be gone         | ~3 min  |

- **Camera and mic check:** records 40 s with the real camera and mic while the page flashes the DELL and beeps every 5 s, then checks, failing fast with what to change: the camera sees the phone's flash; the mic hears the phone's 2 kHz beep and the PC's 1 kHz beep; and the PC beep's delay into the mic is a real acoustic delay. That delay runs from the moment the page scheduled the beep to its onset in the mic, with Chrome's own output latency (the page reports it) taken off. Near 0 (under 5 ms) means Voicemeeter routes the PC's sound digitally into B1, the bus the rig records as the mic, and it FAILs: A/V drift would then measure Voicemeeter's copy, not the mic.

- **Selftest:** no device is opened: the camera and mic are synthetic. It records twice, once with a synthetic screen and once capturing the real screen (ddagrab), where a small black square in the DELL's top-left corner flashes white every 20 s. Then a 60 s kill -9 test.
- **The screen:** every mode records the monitor named `DELL U2424H` (`--screen-name`). `./rig screens` lists the outputs by name; nothing is captured. `--screen N` forces an index.
- **Baseline:** launches OBS if it isn't running, sets the `Landscape Recording` profile (as CVM does), the **Code** scene and the Virtual Camera, starts recording through obs-websocket, opens the page fullscreen on the DELL, records 30 min, stops, and takes the file from OBS's StopRecord reply.
- **Close OBS:** stops any recording and the Virtual Camera, then WM_CLOSE, then `taskkill` without `/F`, and a force-kill only as a last resort. Steps 2, 6 and 7 check OBS is gone first, close it again if it came back, and fail the step if it won't go.
- **Record:** the page runs fullscreen on the DELL and does what your keys did: switches scene every 90 s, and 5 min in saves the ghost frame (T) and shows it for 30 s (G). It compares itself with the latest baseline automatically.
- **Windows stays awake** for the whole run (`lib/awake.ps1`): a display-and-system power request, a zero-distance mouse nudge every 30 s so no inactivity lock fires, and the screensaver, Dynamic Lock and the AC sleep, hibernate and display-off timeouts turned off. The original values are saved first and restored at the end, on Ctrl-C, or by the next run if the wizard was killed.

**How the rig finds OBS:** the same way CVM does (`apps/local/live-desk/live-desk.ts`). It uses `VITE_OBS_WEBSOCKET_URL` from the environment or the main checkout's `.env`, and otherwise `ws://localhost:4455`, with no password, as CVM's `obs-connector` connects. The calls go from Windows PowerShell (`lib/obs-ws.ps1`), because WSL is in NAT mode here and only Windows reaches OBS on localhost. `./rig obs url | status | launch | close` drives it by hand.

**The page** opens in a separate Chrome profile (`D:\obs-rig\chrome-kiosk`), fullscreen on the DELL, with sound allowed without a click and camera access without a prompt. Your own Chrome isn't touched. The page closes when the run ends.

`./rig analyze <runDir>` re-runs the analysis on any run, writing its report into the run folder. `./rig rescore <runDir> --scratch <dir> [--baseline <dir>] [--obs-scenes <file>]` re-scores an old run with today's analysis and writes **only** to the scratch folder: the baseline first, into `<scratch>/<its name>`, then the run against that re-scored baseline. `--obs-scenes` is OBS's scene collection JSON, for a baseline from before the rig saved one. `./rig verdict <runDir>` prints one run's stop criteria and exits 0 on PASS; the wizard judges every run with it, including the selftest's kill -9 run, which writes only `meta.json` (judged by `meta.crash`). `./rig check` runs the verdict rules against known-bad and known-good cases, plus the phone markers on synthetic series, in a few seconds. `./rig lipsync-proof` is the synthetic proof below.

## Lip sync without a clap

There are two sync markers. **The PC's:** the page flashes the DELL white and plays a 1 kHz beep through the speakers every 2 min. The screen recording and the mic see it, so it measures **A/V drift** (mic − screen). **The phone's:** the phone in front of the camera flashes white and beeps at 2 kHz every 10 s. The camera and the mic see it, so it measures **lip sync drift** (mic 2 kHz − camera). The phone's times aren't known to the PC, so its onsets are found over the whole run and kept only if they sit on a 10 s grid fitted to them (the phone's clock is its own), and each flash is paired with the beep nearest it. **Camera/screen drift** is derived at each PC marker: (mic 1 kHz − screen) − (mic 2 kHz − camera), using the phone markers within 15 s. The mic cancels out of it, and so does the phone's own A/V offset, so its trend and jumps are the camera's against the screen. All three are judged the same way: trend and jumps (below), never the median alone.

The two beeps can't be mistaken for each other. Both tones sit on a bin centre of the 20 ms analysis window, so a steady 1 kHz tone reads nothing at 2 kHz. A small speaker gives the 1 kHz beep a 2 kHz harmonic, which is kept out three ways: a 2 kHz onset must last 50–180 ms (the phone's beep is 100 ms, the PC's 250 ms), it must be at least twice as strong as 1 kHz at that moment, and phone markers within 1.5 s of a PC marker are dropped.

**Lip sync vs OBS** replaces the clap. In both the baseline and the record run, the camera sees the same phone's flash and the mic hears the same phone's beep. The phone's own A/V offset (its screen against its speaker) is the same in both runs, so it cancels out. The difference between the two runs' median audio − camera offsets is the rig's lip sync relative to OBS today: within 33 ms plus one OBS canvas frame, because the OBS file only shows the camera at its 60 fps canvas ticks. OBS's own per-source **sync offsets** are taken off first: Matt's mic ("Shure MV7") has a deliberate +150 ms Sync Offset in OBS, so OBS's file has the mic 150 ms later than the device delivered it. The baseline saves a copy of OBS's scene collection (`obs-scene-collection.json`), the report names the offset it used, and an unknown offset says "0 assumed". The rig's own files carry no such offset, so to match today's OBS output the new recorder has to apply the same +150 ms to the mic. The phone video's flash and beep are sample-aligned in the file (`./rig phone` checks it at the start, middle and end).

`./rig check` runs the phone path on synthetic series: a camera that sees the phone, a screen, and a mic that holds both beeps (the PC's with a 30% 2 kHz harmonic), with a known phone A/V offset (137 ms) and known drifts. Every verdict reads the injected values: a drift in the camera fails camera/screen and lip sync and passes A/V; a drift in the mic fails A/V and lip sync and passes camera/screen; a drift in the screen fails A/V and camera/screen. `./rig lipsync-proof` does the same through ffmpeg: it renders an OBS-style baseline and four rig runs from lavfi and runs the real analysis on them. Lip sync 10 ms later than OBS passes, 60 ms later fails, audio drifting 0 to 60 ms fails A/V and lip sync, and camera drifting 0 to 60 ms fails camera/screen and lip sync.

Unattended runs also fail, rather than read n/a, when fewer than 3 markers land (the camera doesn't see the phone, or the mic doesn't hear a beep), or when the page never started with sound on.

## Page keys

Unattended, the page needs none of these. They still work if you're there: `1` Camera · `2` Code · `3` No Face · `M` marker · `F` flash and beep now · `T` end of take (saves the ghost frame) · `G` toggle the ghost overlay · `Q` stop

Scene switches and markers are saved with their file time in `events.jsonl`. The HUD shows the preview delay on two paths, both measured when the page has decoded a preview frame:

- **Screen path:** the page decodes its own on-screen millisecond clock (the black and white strip at the top left) out of the screen preview.
- **Camera path:** the time from each white flash until the camera preview brightens. Synthetic runs only: a real camera watches the phone, whose flash times the page doesn't know.

Neither includes the page drawing the composite or the monitor's scan-out, about 1–2 frames more, so neither is full glass-to-glass.

## What to send back

The path the wizard prints at the end. It holds `SUMMARY.md` (every verdict), each run's `report.md`, `report.json`, `meta.json` and `events.jsonl`, and `wizard.log` (the whole console).

## Reading the report

- **Drift** is judged for three pairs: audio/screen (PC markers), audio/camera (lip sync, phone markers), and camera/screen (derived from the two, see above). Each must have a linear trend over the run of 33 ms or less (steady drift), and every marker must sit within 33 ms of the run's median offset (jumps). The median itself is a fixed latency, which you calibrate once.
  - **A/V** takes the page's own timing off each PC marker: the beep is scheduled on the audio clock for the boundary, but the flash goes up on the next animation frame, 4 ms early to 26 ms late on the rig PC (`wallMs` vs `beepWallMs` in `events.jsonl`). The screen onset is moved by that difference (the PC marker table shows it).
  - **Lip sync jumps** are judged on the median of the phone markers within ±30 s of each one, not on single markers: the phone's flash wanders about ±25 ms against its own beep from flash to flash (its display and decoder, not the rig; tails to ±37 ms), which a median of ~6 flashes about halves (the baseline: 36.9 ms worst single marker, 19.1 ms worst median) while a real jump lasting ~35 s or more still moves it by its full size. The trend is still a regression over every marker. Same idea as lip sync vs OBS, which compares whole-run medians.
- **The camera's CFR saw-tooth is taken out before judging.** When the camera's clock runs fast or slow, the recording is kept at a constant frame rate by dropping or repeating a frame, so in the file the camera's offset ramps through up to one frame (33 ms) and snaps back, as in OBS. The rig logs every frame's arrival time before that step, so it can undo it at each marker. The last column of the marker table shows the raw file-time offset. The OBS baseline has no arrival times, so its camera pairs get one frame of extra room.
- **No dropped frames:** no frame lost for good on either file, and the screen must deliver 60 fps against the machine's clock (within 100 ppm). Both the screen and the camera are judged.
- **No capture stalls:** no gap over 100 ms between frames arriving after the first 3 s. A stall followed by a burst loses no frames by count, but the recording freezes and then drops the burst.
- **Recorder keeps up:** each ffmpeg's output time is compared with Windows time at every progress line, and the lag mustn't grow by more than 0.5 s.
- **Preview feeds deliver frames:** each preview feed must deliver its first frame within 10 s and never go quiet for 2 s. The preview connection retries every 0.5 s, so a slow first connect no longer loses the preview for the whole run.
- **kill -9 recovery:** each file must decode cleanly and end no more than 2 s before its own process was killed. The kill time is read on Windows inside the kill call. A killed MKV has no container duration, and CVM reads that field, so the rig remuxes each file in place (stream copy) and keeps the raw one as `*.killed.mkv`. The report shows both.
- **CPU/GPU <= 1.5x OBS** compares total CPU and GPU with the baseline. A ratio that can't be computed FAILs as "not measured", with the reason; it never counts as 0x. typeperf silently leaves `\Processor(_Total)` out of a whole run when its first sample fails (7 of 22 runs on the rig PC, among them the 2026-10-11 baseline), so the collector now samples total CPU in a typeperf of its own (`perf-cpu-total.csv`, with `\Processor Information(_Total)` as a fallback) and restarts it until the header has one.
- **Screen judder** is reported, not judged: the share of output frames the CFR step repeats with a neighbour dropped (frames stamped when ffmpeg reads them, two landing in one 60 fps slot). The OBS baseline has no arrival stamps, so there's no figure yet to hold it to.
- **NVENC % from nvidia-smi is misleading.** It reads 99% even at preset p2 because the GPU clocks down when lightly loaded. Compare GPU and CPU against the baseline instead. A throughput test showed 1.58x real-time headroom at p5.

## Risks found while building it

- **Screen capture pacing (fixed).** ffmpeg paces ddagrab with `Sleep()` and waits for each desktop frame with an 8 ms `AcquireNextFrame` timeout. ffmpeg never raises the Windows timer resolution, and since Windows 10 2004 that resolution is per process, so both waits round up to the default 15.6 ms tick. When a slot's sleep wakes ~15 ms late and the timeout also takes ~15 ms, the slot is more than one frame late and ddagrab skips it. Those frames are lost for good: 59.5–59.9 fps, 14–89 frames short in 3 min. Whenever ddagrab captures, the rig now fixes the screen recorder right after it starts. `lib/timer-resolution.ps1` does three things to that ffmpeg.exe. It calls `timeBeginPeriod(1)` inside it, as libobs does for OBS in its `DllMain`. It opts the process out of power throttling, because otherwise Windows 11 sometimes ignores the 1 ms request for a window-less background process. And it sets the process to High priority, because the screen preview's second Desktop Duplication session still cost about 5 frames a minute at Normal. **Measured** in the selftest's real-screen phase: 59.649 fps and 63 short before, 60.000 fps and 0 lost after, and `./rig selftest` ends `SELFTEST PASS`. If the raise fails, the rig prints a WARNING and records it in `meta.json` (`screenTimerResolution`). `dup_frames=0` is still no option, because it delivers no frames at all while the screen is static, and that stalls the recorder. OBS doesn't skip either: it polls Desktop Duplication without waiting (`AcquireNextFrame(0)`) on its own render clock, a 1 ms-timer sleep plus a QPC spin, and reuses the last image when nothing changed. So it outputs 60 fps whatever the desktop does.
- **ddagrab and a second GPU stream don't share a process well.** Putting screen and camera in one ffmpeg.exe dropped the screen to 55–58 fps. That's why there are two recorder processes, plus a third for the screen preview. They share a clock through Windows wall time.
- **The real devices are untested here,** because the Cam Link and the mic were off-limits. These are untested assumptions: the Cam Link offers 4K NV12 over DirectShow, `-use_wallclock_as_timestamps` is accurate for DirectShow, and a 20 ms mic buffer works. The record and crash runs are the real test.
- **The phone path is untested on the real devices** for the same reason. Untested: the phone downloading through Windows Firewall from the PowerShell server, Files by Google playing the 1080x2400 H.264 file for 2.5 h, the camera's auto exposure with the flash, how loud the phone's beep is in the mic, and the 5 ms acoustic threshold, which is a guess until a real run shows the routed and the acoustic delay side by side. The camera and mic check is where each of these shows up first.
- **The WSL clock ran about 4% slow against Windows** on this machine. The rig never uses WSL time for anything it measures.
