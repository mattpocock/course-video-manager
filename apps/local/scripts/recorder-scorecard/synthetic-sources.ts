/**
 * THE SCORECARD'S SYNTHETIC SOURCES: what ffmpeg.exe reads in place of the
 * Cam Link, the mic and the DELL. No capture device, no screen.
 *
 * Every picture source burns the Windows wall clock (ms, 28 bits) into a
 * 320x180 frame as a 7x4 grid of 40 px blocks, the same code
 * `scripts/preview-latency.ts` reads back. A frame's own capture time is then
 * readable wherever the frame ends up: in the browser (preview latency), and
 * in camera.mkv and screen.mkv (first frame after Record, repeated and
 * dropped frames, video lag across a long take).
 *
 * The mic is a quiet 440 Hz bed (-46 dBFS, under the calibration's silence
 * threshold, so the file is never digital silence once it has real audio)
 * with a loud 1 kHz burst of `BURST_ON_SECONDS` every `BURST_PERIOD_SECONDS`:
 * each burst is speech to the recorder's silencedetect (a Take, an
 * Optimistic Clip), and each burst's onset is an A/V drift marker.
 */

export const CLOCK_BITS = 28;
export const CLOCK_MOD = 2 ** CLOCK_BITS;
export const CLOCK_WIDTH = 320;
export const CLOCK_HEIGHT = 180;

/** Centre of bit `k`'s block in the 320x180 frame. */
export const clockBitCentre = (k: number) => ({
  x: 20 + (k % 7) * 40 + 20,
  y: 10 + Math.floor(k / 7) * 40 + 20,
});

/**
 * A 320x180 picture at `rate` whose blocks spell, in Windows wall time (ms),
 * when the frame was made: like ddagrab's, a frame's capture time.
 *
 * - The clock is the time each frame leaves `realtime`, not the time it was
 *   due. `realtime` never drops a late frame, it only stops sleeping: a source
 *   that falls behind would stamp a backlog that grows without limit, which a
 *   real ddagrab (always the newest desktop frame) never has. That backlog
 *   read as preview latency.
 * - The bits are worked out on a 7x4 grid, one value per block, and scaled up
 *   40x. Per pixel (`geq` over 320x180) the clock cost ~7 ms of a core per
 *   frame, at Idle priority on cores 6-9 during a take: the source starved.
 * - Downstream sees the due time again (`N/FRAME_RATE`, from the first
 *   frame), so the recorder's inputs are paced as before, free of the
 *   source's own jitter.
 */
const clockPicture = (rate: string) =>
  `color=c=black:s=7x4:r=${rate},settb=AVTB,` +
  "setpts='if(eq(N\\,0)\\,st(0\\,RTCTIME-PTS)\\,0);PTS+ld(0)',realtime," +
  "setpts=RTCTIME,format=gray," +
  "geq=lum='255*mod(floor(floor(T*1000)/pow(2\\,X+7*Y))\\,2)'," +
  `scale=${CLOCK_WIDTH - 40}:${CLOCK_HEIGHT - 20}:flags=neighbor,` +
  `pad=${CLOCK_WIDTH}:${CLOCK_HEIGHT}:20:10:black,format=yuv420p,` +
  "setpts='if(eq(N\\,0)\\,st(0\\,PTS)\\,0);ld(0)+N/FRAME_RATE/TB'";

export const CAMERA_RATE = "30000/1001";
export const CAMERA_FPS = 30000 / 1001;
export const SCREEN_FPS = 60;

/** The Cam Link stand-in: 320x180 here, made 4K NV12 on the GPU where the capture reads it. */
export const CAMERA_SOURCE = clockPicture(CAMERA_RATE);

/**
 * The capture graph's head for the stand-in: up to the Cam Link's 4K NV12
 * on the GPU (one upload, as the real frame has), then the capture's own
 * chain from there.
 */
export const CAMERA_TO_4K_ON_GPU =
  "format=nv12,hwupload_cuda,scale_cuda=3840:2160:interp_algo=nearest,";

/**
 * The DELL stand-in: the clock at 60 fps, 320x180 NV12, made 1920x1080 on
 * the GPU as a D3D11 frame where ddagrab's would be (`SCREEN_TO_D3D11`).
 * NV12, not ddagrab's BGRA: D3D11's video processor will not output BGRA,
 * and a 1080p60 BGRA frame made on the CPU could not keep up at 60 fps.
 */
export const SCREEN_SOURCE = `${clockPicture(String(SCREEN_FPS))},format=nv12`;
export const SCREEN_TO_D3D11 = "hwupload,scale_d3d11=1920:1080:format=nv12";

/** The same for the libx264 screen preview, which takes BGRA in system memory. */
export const SCREEN_SOURCE_CPU = `${clockPicture(String(SCREEN_FPS))},scale=1920:1080:flags=neighbor,format=bgra`;

export const BURST_PERIOD_SECONDS = 6;
export const BURST_ON_SECONDS = 2.5;
/** The silence threshold the scorecard's AV Calibration says (dB): between the bed and the bursts. */
export const SYNTHETIC_THRESHOLD_DB = -30;

/** The mic stand-in: 48 kHz stereo in 20 ms buffers, paced in real time. */
export const MIC_SOURCE =
  `aevalsrc='0.005*sin(2*PI*440*t)+0.5*sin(2*PI*1000*t)*lt(mod(t\\,${BURST_PERIOD_SECONDS})\\,${BURST_ON_SECONDS})'` +
  ":s=48000:n=960:c=stereo,arealtime";

/** The screen list `screens.ps1` would print: the DELL alone, as output 0. */
export const SYNTHETIC_SCREENS =
  "0\t0\t0\t1920\t1080\t60\tDELL U2424H\tsynthetic (recorder scorecard)\n";

/** What `ffmpeg -list_devices` would print: the two devices the recorder looks for, by name. */
export const SYNTHETIC_DEVICE_LISTING = [
  '[in#0 @ 0000000000000000] "Cam Link 4K" (video)',
  '[in#0 @ 0000000000000000] "Voicemeeter Out B1" (audio)',
  "Error opening input file dummy.",
  "",
].join("\n");
