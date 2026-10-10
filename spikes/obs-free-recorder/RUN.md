# OBS-free recorder rig: how to run it

This is a spike for architecture (b): ffmpeg.exe records the camera, screen and mic to three separate files, and a browser page draws the preview. Run every command from WSL in this folder. Each run writes to `D:\obs-rig\runs\<time>-<mode>\` and ends by printing `report.md`, the verdict against the stop criteria.

ffmpeg must be **8.0.1** (`winget install Gyan.FFmpeg --version 8.0.1`). Versions 8.1 and 9.x need NVIDIA driver 610 or later for NVENC, and this machine has 591.74. Run `winget pin add Gyan.FFmpeg` so that `winget upgrade` doesn't break NVENC.

## The runs, in order

| #   | Command                            | OBS           | Takes   | What you do                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `./rig selftest`                   | can stay open | ~8 min  | Nothing. It uses synthetic sources only, and no device is opened. It should end with `SELFTEST PASS`.                                                                                                                                                                                 |
| 2   | `./rig screens`                    | either        | 10 s    | Open the PNGs it prints and note which index is the DELL. The default is 0. If it's another index, add `--screen N` to steps 3–5.                                                                                                                                                     |
| 3   | `./rig baseline`                   | **open**      | ~32 min | In OBS, pick the **Code** scene, click **Start Virtual Camera**, then **Start Recording**. Drag the Chrome tab that opens onto the DELL and click it. It goes fullscreen. Clap on camera once at the start and once at the end. Stop recording in OBS when the terminal tells you to. |
| 4   | **Close OBS**, then `./rig record` | closed        | ~32 min | Same as step 3: page fullscreen on the DELL, clap at the start and end. Press 1/2/3 a few times to switch scenes, and press T then G to try the ghost frame. Leave the page visible. This is a measurement run, not a real take.                                                      |
| 5   | `./rig crash`                      | closed        | ~3 min  | Nothing. It records for 60 s, force-kills ffmpeg (the Windows kill -9), and checks the files still play.                                                                                                                                                                              |

For runs 3 and 4:

- **Use speakers, not headphones.** The mic has to hear the sync beep.
- **Point the camera so it sees part of the DELL**, or sit where the white flash lights your face.
- Every 2 minutes the page flashes the screen white and beeps (`--flash-every N` changes this).
- `--minutes N` shortens a run, for example `./rig record --minutes 5` as a first try.

`./rig record` compares itself against the latest baseline automatically. `./rig analyze <runDir>` re-runs the analysis on any run.

## Page keys

`1` Camera · `2` Code · `3` No Face · `M` marker · `F` flash and beep now · `C` "I clapped" · `T` end of take (saves the ghost frame) · `G` toggle the ghost overlay · `Q` stop

Scene switches and markers are saved with their file time in `events.jsonl`. The HUD shows preview latency. The page measures it by decoding its own on-screen millisecond clock (the black and white strip at the top left) out of the preview it receives.

## What to send back

The `report.md` from each run. For runs 4 and 5, also `clap-start.png` and `clap-end.png`: the strip of camera frames around the loudest clap. Find the frame where your hands meet and compare its time with the time in `clap-*.txt`.

## Reading the report

- **Drift** is how far each marker's offset strays from the run's median offset. The median itself is a fixed latency, which you calibrate once.
- **The camera offset saw-tooths within one frame (33 ms).** When the camera's clock runs fast or slow, the recording is kept at a constant frame rate by dropping or repeating a single frame. This doesn't add up over time. OBS does the same thing.
- **"No dropped frames"** counts camera frames lost at capture, plus any recorder process falling behind real time. The screen is captured by repeating the latest image, so it can't "lose" a frame the same way.
- **NVENC % from nvidia-smi is misleading.** It reads 99% even at preset p2 because the GPU clocks down when lightly loaded. Compare GPU and CPU against the baseline instead. A throughput test showed 1.58x real-time headroom at p5.

## Risks found while building it

- **Screen capture pacing.** ffmpeg paces ddagrab with `Sleep()`, which ticks every 15.6 ms on Windows because ffmpeg never raises the timer resolution. Captures therefore land up to ~15 ms after the frame was shown, and smooth scrolling may judder slightly. `dup_frames=0` fixes the timing, but it delivers no frames at all while the screen is static, and that stalls the recorder. Watch the screen file for judder.
- **ddagrab and a second GPU stream don't share a process well.** Putting screen and camera in one ffmpeg.exe dropped the screen to 55–58 fps. That's why there are two recorder processes, plus a third for the screen preview. They share a clock through Windows wall time.
- **The real devices are untested here,** because the Cam Link and the mic were off-limits. These are untested assumptions: the Cam Link offers 4K NV12 over DirectShow, `-use_wallclock_as_timestamps` is accurate for DirectShow, and a 20 ms mic buffer works. Steps 4 and 5 are the real test.
- **The WSL clock ran about 4% slow against Windows** on this machine. The rig never uses WSL time for anything it measures.
