# OBS-free recorder rig: how to run it

This is a spike for architecture (b): ffmpeg.exe records the camera, screen and mic to three separate files, and a browser page draws the preview. Run every command from WSL in this folder. Each run writes to `D:\obs-rig\runs\<time>-<mode>\` and ends by printing `report.md`, the verdict against the stop criteria.

ffmpeg must be **8.0.1** (`winget install Gyan.FFmpeg --version 8.0.1`). Versions 8.1 and 9.x need NVIDIA driver 610 or later for NVENC, and this machine has 591.74. It's pinned on this machine (`winget pin add --id Gyan.FFmpeg --version 8.0.1`, so `winget upgrade` skips it), and every mode refuses to start on any other version (`--any-ffmpeg` overrides that).

## The runs, in order

| #   | Command                            | OBS           | Takes   | What you do                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------- | ------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `./rig selftest`                   | can stay open | ~13 min | Nothing, but don't run it while filming. No device is opened: the camera and mic are synthetic. It records twice, once with a synthetic screen and once capturing the real screen (ddagrab), where a small black square in the top-left corner of the captured screen flashes white every 20 s. Then a 60 s kill -9 test. It ends with `SELFTEST PASS` or `SELFTEST FAIL` and the failing verdicts. |
| 2   | `./rig screens`                    | either        | 10 s    | Open the PNGs it prints and note which index is the DELL. The default is 0. If it's another index, add `--screen N` to steps 3–5.                                                                                                                                                                                                                                                                   |
| 3   | `./rig baseline`                   | **open**      | ~32 min | In OBS, pick the **Code** scene, click **Start Virtual Camera**, then **Start Recording**. Drag the Chrome tab that opens onto the DELL and click it. It goes fullscreen. Clap on camera once at the start and once at the end. Stop recording in OBS when the terminal tells you to.                                                                                                               |
| 4   | **Close OBS**, then `./rig record` | closed        | ~32 min | Same as step 3: page fullscreen on the DELL, clap at the start and end. Press 1/2/3 a few times to switch scenes, and press T then G to try the ghost frame. Leave the page visible. This is a measurement run, not a real take.                                                                                                                                                                    |
| 5   | `./rig crash`                      | closed        | ~3 min  | Nothing. It records for 60 s, force-kills ffmpeg (the Windows kill -9), and checks the files still play.                                                                                                                                                                                                                                                                                            |

For runs 3 and 4:

- **Use speakers, not headphones.** The mic has to hear the sync beep.
- **Point the camera so it sees part of the DELL**, or sit where the white flash lights your face.
- Every 2 minutes the page flashes the screen white and beeps (`--flash-every N` changes this).
- `--minutes N` shortens a run, for example `./rig record --minutes 5` as a first try.

`./rig record` compares itself against the latest baseline automatically. `./rig analyze <runDir>` re-runs the analysis on any run. `./rig check` runs the verdict rules against known-bad and known-good cases in under a second. The selftest runs it first.

## Page keys

`1` Camera · `2` Code · `3` No Face · `M` marker · `F` flash and beep now · `C` "I clapped" · `T` end of take (saves the ghost frame) · `G` toggle the ghost overlay · `Q` stop

Scene switches and markers are saved with their file time in `events.jsonl`. The HUD shows the preview delay on two paths, both measured when the page has decoded a preview frame:

- **Screen path:** the page decodes its own on-screen millisecond clock (the black and white strip at the top left) out of the screen preview.
- **Camera path:** the time from each white flash until the camera preview brightens. It only works if the camera sees the flash (part of the DELL, or the light on your face).

Neither includes the page drawing the composite or the monitor's scan-out, about 1–2 frames more, so neither is full glass-to-glass.

## What to send back

The `report.md` from each run. For runs 4 and 5, also `clap-start.png` and `clap-end.png`: the strip of camera frames around the loudest clap. Find the frame where your hands meet and compare its time with the time in `clap-*.txt`.

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
- **The real devices are untested here,** because the Cam Link and the mic were off-limits. These are untested assumptions: the Cam Link offers 4K NV12 over DirectShow, `-use_wallclock_as_timestamps` is accurate for DirectShow, and a 20 ms mic buffer works. Steps 4 and 5 are the real test.
- **The WSL clock ran about 4% slow against Windows** on this machine. The rig never uses WSL time for anything it measures.
