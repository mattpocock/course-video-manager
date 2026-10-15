import {
  MOTION_FILTERS,
  MOTION_KEY,
} from "../app/packages/clap-detection/live";
import { BT709, SCREEN_TO_NV12 } from "./colour";

/**
 * THE CAPTURE (#2207): the devices open once, when the recorder opens, and
 * stay open; Record and Stop only start and stop writing. Three kinds of
 * ffmpeg.exe:
 *
 *   camera capture (long-lived):  Cam Link 4K + mic, nothing encoded. The
 *       picture, at camera.mkv's size (1440p, scaled on the GPU), goes out
 *       raw on two relays: to the camera preview, and to the take's writer.
 *       The mic, on its clock (`micAnchor`), goes to the writer's relay.
 *   camera preview (long-lived):  the preview relay -> the preview stream
 *       (`previewOutput`) and the thumbnail camera's still. The same process,
 *       encoder and settings whether a take is running or not.
 *   camera writer (one per take): the writer relay -> camera.mkv + mic.mkv,
 *       and silencedetect on the mic audio it writes. Armed before Record,
 *       it drops every frame until Record says when T0 is
 *       (`takeStartCommand`).
 *   screen recorder (one per take): ddagrab -> screen.mkv (none for a Short
 *       whose display is unavailable). The screen preview is its own process
 *       (`screenPreviewArgs`): any second GPU stream in the screen recorder's
 *       process (camera upload, scale, NVENC or a read-back) made ddagrab
 *       miss frames, 55-58 fps against 59.7-59.8 split (#1992).
 *
 * Each relay is Matroska over loopback TCP (`RELAY_FORMAT`), behind tee's
 * dropping, retrying fifo: the capture never waits on a consumer, so a
 * preview that dies or stalls cannot touch camera.mkv, and a writer that
 * dies cannot freeze the preview.
 * A frame the writer's relay drops shows as a gap the writer logs
 * (`FRAME_GAP_SECONDS`), so a loss is never silent.
 *
 * ONE SHARED CLOCK. Every input is stamped with Windows wall time
 * (-use_wallclock_as_timestamps), -copyts keeps every process from zeroing
 * it, and every file subtracts the same T0. File time t then means wall time
 * T0 + t in all three files. fps=…:start_time=0 and aresample=…:first_pts=0
 * make each file CFR from exactly t=0. The mic's stamps only anchor it: its
 * audio is timed by sample count (`micAnchor`).
 */

export const FILE_NAMES = {
  screen: "screen.mkv",
  camera: "camera.mkv",
  mic: "mic.mkv",
} as const;

/** The 100 ns frame interval the Cam Link 4K advertises for 2160p29.97. */
export const CAM_LINK_FRAME_INTERVAL = 333667;

/**
 * The 100 ns frame interval ffmpeg's dshow input asks the device for, as
 * libavdevice/dshow.c (8.0) computes it: den * 10^7 / num, truncated. A format
 * whose interval range does not contain it is skipped, and with none left
 * ffmpeg fails "Could not set video options". 30000/1001 truncates to 333666,
 * one short of the Cam Link's 333667, so it never opened; "29.97" (read as
 * 2997/100) gives exactly 333667.
 */
export const dshowFrameInterval = (rate: string): number => {
  const [n, d = "1"] = rate.split("/");
  const dec = (x: string) => {
    const [i, f = ""] = x.split(".");
    return { num: BigInt(i + f), den: 10n ** BigInt(f.length) };
  };
  const a = dec(n ?? "0");
  const b = dec(d);
  return Number((b.num * a.den * 10_000_000n) / (a.num * b.den));
};

export const CAM_DSHOW_FRAMERATE = "29.97";

/**
 * OBS's "Landscape Recording": NVENC H.264, CQP 23, p5 + hq, High, 2
 * B-frames. GOP 2 s, so a crash loses at most one GOP.
 */
export const nvenc = (gopFrames: number) => [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p5",
  "-tune",
  "hq",
  "-rc",
  "constqp",
  "-qp",
  "23",
  "-profile:v",
  "high",
  "-bf",
  "2",
  "-g",
  String(gopFrames),
  "-fps_mode",
  "passthrough",
];

/**
 * MKV, not fragmented MP4 (which put the first video frame two frames late),
 * with 1 s clusters: a cluster is held in memory until it closes, so the
 * cluster time bounds what a hard kill loses.
 */
export const MKV = [
  "-cluster_time_limit",
  "1000",
  "-flush_packets",
  "1",
  "-f",
  "matroska",
];

export const WALLCLOCK = [
  "-use_wallclock_as_timestamps",
  "1",
  "-thread_queue_size",
  "512",
];

/**
 * Behind tee's fifo, as the rig (#1992) settled it: a preview consumer that
 * dies or stalls must never stop a recording, and a slow Windows -> WSL
 * connect must not lose the preview for good, so each feed has its own
 * queue, packets dropped when full, the connection retried every 0.5 s. The
 * null output keeps the tee alive. The socket sends each packet as soon as
 * it is written (no Nagle).
 */
const teeToFeed = (port: number, format: string, queueSize: number) =>
  teeWith(queueSize, `${feedSlave(port, format)}|[f=null:use_fifo=0]-`);

const teeWith = (queueSize: number, slaves: string) => [
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  `attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:drop_pkts_on_overflow=1:queue_size=${queueSize}`,
  slaves,
];

const feedSlave = (port: number, format: string) =>
  `[f=${format}:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000&tcp_nodelay=1`;

/**
 * What each raw relay is muxed as (#2211, ADR 0048). Its consumer comes and
 * goes (a writer per take, a preview started again), and the fifo opens the
 * relay again for the next. NUT cannot be opened twice: it took the whole
 * capture down. The writer's is Matroska, for the mic and the stamps. The
 * preview's is bare frames, stamped as they arrive: Matroska held each
 * frame until the next (+35 ms).
 */
export const RELAY_FORMAT = {
  writer: "matroska",
  preview: "rawvideo",
} as const;

/**
 * A raw relay (#2207): loopback TCP to a consumer that listens on Windows
 * (the camera preview, or the take's writer), behind the same dropping,
 * retrying fifo as a preview feed. A consumer that is gone or stalls costs
 * only its own packets; the capture never waits on it, and the next
 * consumer on the port gets the relay from its next packet.
 */
const teeToRelay = (
  relay: keyof typeof RELAY_FORMAT,
  port: number,
  queueSize: number
) =>
  teeWith(
    queueSize,
    `[f=${RELAY_FORMAT[relay]}:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000&tcp_nodelay=1|[f=null:use_fifo=0]-`
  );

/** Where a camera capture's relays go: Windows loopback ports its consumers listen on. */
export type CameraRelays = { preview: number; writer: number };

/**
 * What encodes a preview stream (#2194): NVENC, or libx264 on the CPU once
 * NVENC would not open for that feed (`preview-encoders.ts`).
 */
export type PreviewEncoder = "nvenc" | "x264";

/**
 * The preview's NVENC encode, tuned for latency: the fastest preset, the
 * ultra-low-latency tune, no B-frames, no lookahead, no reordering delay, a
 * keyframe exactly every `gopFrames` (IDR, no scene cuts). High profile and
 * 4:2:0 whatever comes in (the screen is BGRA), which WebCodecs decodes in
 * hardware. Constant QP 21 is near-transparent at preview size.
 */
const previewNvenc = (gopFrames: number) => [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p1",
  "-tune",
  "ull",
  "-zerolatency",
  "1",
  "-delay",
  "0",
  "-rc-lookahead",
  "0",
  "-bf",
  "0",
  "-rc",
  "constqp",
  "-qp",
  String(PREVIEW_QP),
  "-profile:v",
  "high",
  "-g",
  String(gopFrames),
  "-forced-idr",
  "1",
  "-no-scenecut",
  "1",
];

/**
 * The CPU fallback, as #2192 shipped it: libx264 ultrafast + zerolatency,
 * no B-frames, no lookahead, each frame out as soon as it is in.
 */
const previewX264 = (gopFrames: number) => [
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-tune",
  "zerolatency",
  "-crf",
  String(PREVIEW_CRF),
  "-pix_fmt",
  "yuv420p",
  "-g",
  String(gopFrames),
  "-x264-params",
  `keyint_min=${gopFrames}:scenecut=0:threads=${PREVIEW_THREADS}`,
];

/**
 * A preview output: the picture at full size as a low-latency H.264 stream
 * to the service's TCP feed for it (#2192), which relays it to the browser
 * to decode in hardware (`preview-feeds.ts`). On NVENC (#2194), with libx264
 * as the fallback (`PreviewEncoder`). A keyframe a second, so a browser that
 * joins late (or loses a packet) is whole within a second. In FLV, whose
 * tags carry their own lengths: the service hands a frame on the moment its
 * last byte is in, with no container to wait on.
 *
 * The fifo may hold a few frames: a dropped packet breaks the picture until
 * the next keyframe, so it drops only when the service has stopped reading.
 */
export const previewOutput = (
  port: number,
  gopFrames: number,
  encoder: PreviewEncoder
) => [
  "-fps_mode",
  "passthrough",
  ...(encoder === "nvenc" ? previewNvenc(gopFrames) : previewX264(gopFrames)),
  // The tee hides FLV's need for the SPS/PPS up front: ask for them.
  "-flags",
  "+global_header",
  ...teeToFeed(port, "flv", 8),
];

/** libx264's quality: near-transparent, the preview is not to look any softer than the Footage. */
const PREVIEW_CRF = 18;

/** NVENC's: about libx264's CRF 18 at the preview's sizes. */
const PREVIEW_QP = 21;

/** libx264's threads per preview: enough for 1440p30 or 1080p60 in real time, short of every core. */
const PREVIEW_THREADS = 4;

/**
 * The thumbnail camera's still feed: MJPEG at high quality, the latest of
 * which the service keeps (`GET /still`). It is never drawn live, so each
 * JPEG stands alone and the fifo holds two at most.
 */
const stillOutput = (port: number) => [
  "-fps_mode",
  "passthrough",
  "-c:v",
  "mjpeg",
  "-q:v",
  "2",
  ...teeToFeed(port, "mpjpeg", 2),
];

/**
 * In each preview ffmpeg.exe's command line, so one left running by a service
 * that died can be found and stopped (`stop-recorders.ps1`). A preview never
 * exits by itself: its tee retries a dead feed for ever.
 */
export const PREVIEW_TAGS = {
  camera: "cvm-recorder-preview-camera",
  screen: "cvm-recorder-preview-screen",
} as const;

/** In the camera capture's command line, for the same reason: it never exits by itself. */
export const CAPTURE_TAG = "cvm-recorder-capture-camera";

/** In the level meter's command line, for the same reason: it never exits by itself. */
export const METER_TAG = "cvm-recorder-meter";

const tagged = (tag: string) => ["-metadata", `comment=${tag}`];

const PREVIEW_HEAD = ["-hide_banner", "-nostats", "-loglevel", "level+warning"];

/** A keyframe a second at the Cam Link's 29.97 fps. */
const CAMERA_PREVIEW_GOP = 30;

/**
 * How many bytes of frames DirectShow may hold for ffmpeg: 4K NV12 is 12.4 MB
 * a frame. The capture feeds every take, which must never drop one, so it
 * may hold about four seconds' worth.
 */
const RTBUF = "1500M";

/** The Cam Link 4K as DirectShow opens it, for recording and preview alike. */
const camLinkInput = (camera: string) => [
  "-f",
  "dshow",
  "-rtbufsize",
  RTBUF,
  "-video_size",
  "3840x2160",
  "-framerate",
  CAM_DSHOW_FRAMERATE,
  "-pixel_format",
  "nv12",
  "-i",
  `video=${camera}`,
];

/**
 * The mic as DirectShow opens it (`MIC_NAME`, Voicemeeter Out B1), raw: no
 * filters, and a 20 ms device buffer keeps the stamp close to capture. The
 * recording and the level meter open it the same way, so the meter reads the
 * very signal mic.mkv gets.
 */
export const micInput = (mic: string) => [
  "-f",
  "dshow",
  "-audio_buffer_size",
  "20",
  "-sample_rate",
  "48000",
  "-channels",
  "2",
  "-i",
  `audio=${mic}`,
];

/** The size of the picture both relays carry: camera.mkv's. */
const CAMERA_RELAY_SIZE = "2560x1440";

/** The picture both relays carry: camera.mkv's size, scaled on the GPU as the recording always scaled it. */
const CAMERA_RELAY_PICTURE =
  "hwupload_cuda,scale_cuda=2560:1440:interp_algo=bicubic,hwdownload,format=nv12";

/**
 * The relays' raw picture. One thread: ffmpeg's rawvideo encoder is
 * frame-threaded, and its threads hold each frame until the next one comes,
 * a whole frame (33 ms) late on every relay (#2207, measured).
 */
const RAW_RELAY = ["-c:v", "rawvideo", "-threads:v", "1"];

/** Packets the preview relay may queue: a preview that falls behind drops frames instead of showing them late. */
const PREVIEW_RELAY_QUEUE = 4;

/**
 * Packets (frames and 20 ms mic buffers) the writer relay may queue: about
 * two seconds, room for camera.mkv's NVENC to open at Record (#2207).
 */
const WRITER_RELAY_QUEUE = 160;

/**
 * THE CAMERA CAPTURE (#2207): the Cam Link and the mic, opened when the
 * recorder opens and held until it closes, with no encoder of its own that
 * could fail. The picture goes raw to the camera preview's relay and to the
 * writer's; the mic, on its clock, to the writer's. Logged at info, so a mic
 * stall (`micAnchor`) and DirectShow's dropped frames show.
 */
export const cameraCaptureArgs = (o: {
  camera: string;
  mic: string;
  relays: CameraRelays;
}) => [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+info",
  "-copyts",
  ...WALLCLOCK,
  ...camLinkInput(o.camera),
  ...WALLCLOCK,
  ...micInput(o.mic),
  "-filter_complex",
  `[0:v]${CAMERA_RELAY_PICTURE},split[prev][rec];${micAnchor()}[mic]`,
  "-map",
  "[prev]",
  "-fps_mode",
  "passthrough",
  // The stamps as they come (100 ns from DirectShow), not rounded to the
  // frame rate's ticks: T0 and the gaps are read to the frame and below.
  "-enc_time_base:v",
  "filter",
  ...RAW_RELAY,
  ...tagged(CAPTURE_TAG),
  ...teeToRelay("preview", o.relays.preview, PREVIEW_RELAY_QUEUE),
  "-map",
  "[rec]",
  "-map",
  "[mic]",
  "-fps_mode",
  "passthrough",
  "-enc_time_base:v",
  "filter",
  ...RAW_RELAY,
  "-c:a",
  "pcm_s16le",
  ...tagged(CAPTURE_TAG),
  ...teeToRelay("writer", o.relays.writer, WRITER_RELAY_QUEUE),
];

/** A relay's consumer: it listens on Windows' loopback for the capture's relay. */
export const relayInput = (relay: keyof typeof RELAY_FORMAT, port: number) => [
  // The header (or, bare, these arguments) says all there is: probing would
  // only hold back the first packets, a backlog never caught up on.
  "-probesize",
  "32",
  "-analyzeduration",
  "0",
  ...(relay === "preview"
    ? [
        // Bare frames carry no stamps: each is stamped as it arrives.
        "-use_wallclock_as_timestamps",
        "1",
        "-pix_fmt",
        "nv12",
        "-video_size",
        CAMERA_RELAY_SIZE,
        "-framerate",
        "30000/1001",
      ]
    : []),
  "-f",
  RELAY_FORMAT[relay],
  "-i",
  `tcp://127.0.0.1:${port}?listen=1&tcp_nodelay=1`,
];

/**
 * The thumbnail camera's still (#2012): 1280x720, the size the OBS Virtual
 * Camera gave it, a few times a second at a high JPEG quality.
 */
const cameraStillChain: Record<PreviewEncoder, string> = {
  nvenc:
    "scale_cuda=1280:720:interp_algo=bicubic,hwdownload,format=nv12,fps=4,format=yuvj420p",
  x264: "scale=1280:720:flags=bicubic,fps=4,format=yuvj420p",
};

/**
 * THE CAMERA PREVIEW (#2207): the capture's preview relay to the preview
 * stream, plus the thumbnail camera's still feed. One process for as long as
 * the capture runs, recording or not: Record and Stop never touch it. Its
 * first frame is how the service knows the camera is live. NVENC takes the
 * picture on the GPU; libx264 takes it as it comes.
 */
export const cameraPreviewArgs = (o: {
  relayPort: number;
  port: number;
  stillPort: number;
  encoder: PreviewEncoder;
}) => [
  ...PREVIEW_HEAD,
  "-fflags",
  "nobuffer",
  ...relayInput("preview", o.relayPort),
  "-filter_complex",
  `[0:v]${o.encoder === "nvenc" ? "hwupload_cuda," : ""}split[prev][s];[s]${cameraStillChain[o.encoder]}[still]`,
  "-map",
  "[prev]",
  ...tagged(PREVIEW_TAGS.camera),
  ...previewOutput(o.port, CAMERA_PREVIEW_GOP, o.encoder),
  "-map",
  "[still]",
  ...stillOutput(o.stillPort),
];

/**
 * The screen preview: a second Desktop Duplication session (Windows allows
 * several) in its own ffmpeg.exe, which can stall, crash or be stopped
 * without touching the screen recorder. At the screen's own size and 60
 * fps, as the screen is recorded and as OBS previews it: nothing is scaled
 * (#2192). For NVENC (#2194) the frame is made NV12 on the GPU exactly as
 * the screen recorder makes it (`SCREEN_TO_NV12`): NVENC fed BGRA converts
 * each frame itself and fell behind 60 fps (41-49 fps, synthetic). libx264
 * takes BGRA down on the CPU and converts it to the same BT.709 limited
 * range, so the preview's black is the recording's.
 */
/** What the screen preview does to ddagrab's D3D11 BGRA frame before its encoder. */
export const SCREEN_PREVIEW_CHAIN: Record<PreviewEncoder, string> = {
  nvenc: SCREEN_TO_NV12,
  x264: `hwdownload,format=bgra,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709}`,
};

export const screenPreviewArgs = (o: {
  screenIndex: number;
  port: number;
  encoder: PreviewEncoder;
}) => [
  ...PREVIEW_HEAD,
  "-f",
  "lavfi",
  "-i",
  `ddagrab=output_idx=${o.screenIndex}:framerate=60,${SCREEN_PREVIEW_CHAIN[o.encoder]}`,
  "-map",
  "0:v",
  ...tagged(PREVIEW_TAGS.screen),
  ...previewOutput(o.port, 60, o.encoder),
];

/** The camera (input 0) stamped in file time: wall time less T0. */
const cameraOnT0 = (t0: string) => `[0:v]setpts=PTS-${t0}/TB`;

/** CFR 29.97 from exactly t=0. */
export const CAMERA_CFR = "fps=30000/1001:start_time=0";

/**
 * The camera (input 0) on the shared clock: wall time less T0, then CFR
 * 29.97 from exactly t=0. A Recording Session and an AV Calibration's run
 * both stamp it so, which is what makes a calibration's Mic Offset the
 * recording's.
 */
const cameraOnClock = (t0: string) => `${cameraOnT0(t0)},${CAMERA_CFR}`;

/**
 * How fast the mic's anchor may move later, in seconds per second of mic
 * audio: far above any sound card's clock error (tens of ppm), far below a
 * stall's (a 400 ms stall moves it 0.2 ms).
 */
const MIC_ANCHOR_RISE = 0.0005;

/** A mic buffer read this late (seconds) is logged as a stall. */
const MIC_STALL_LOGGED = 0.05;

/**
 * The mic on Windows wall time, timed by sample count (#2120).
 *
 * Its wall-time stamps cannot be trusted one by one: ffmpeg sometimes stops
 * reading the mic for 100-400 ms, then reads the backlog all stamped "now".
 * Following those stamps, aresample padded the gap with silence and was left
 * tens of ms out, a different amount every take. So a buffer's time is the
 * mic's anchor plus the samples before it. The anchor is the earliest time
 * any buffer so far says the mic started (its stamp less the samples before
 * it): a late buffer only ever says later, so a stall cannot move it. To
 * follow a sound card whose clock runs slow against Windows, it may creep
 * later by `MIC_ANCHOR_RISE`; aresample's async=50 follows the small steps
 * either way. With no stall a buffer keeps its stamp, give or take the
 * jitter in how soon ffmpeg reads it.
 *
 * The first buffer of a stall (read more than `MIC_STALL_LOGGED` late)
 * logs how late it was as a bare number of seconds ("[info] 0.391306"), so
 * the log still shows the stalls the mic file no longer does.
 *
 * The camera capture runs it from the moment the mic opens, for every take
 * after (#2207); an AV Calibration's run, from its own start (`micOnClock`).
 */
export const micAnchor = (input = "1:a") => {
  const startedAt = "PTS*TB-N/SR";
  const anchor = `st(0,if(N,min(ld(0)+${MIC_ANCHOR_RISE}*(N-ld(1))/SR,${startedAt}),${startedAt}))`;
  // ld(2): how late this buffer was read; logged on the first of a stall.
  const late = `st(3,ld(2));st(2,${startedAt}-ld(0))`;
  const stallLog = `if(gt(ld(2),${MIC_STALL_LOGGED})*lte(ld(3),${MIC_STALL_LOGGED}),print(ld(2),32))`;
  return `[${input}]asetpts='${anchor};${late};${stallLog};st(1,N);(ld(0)+N/SR)/TB'`;
};

/** The mic file's CFR audio from exactly t=0. */
export const MIC_FROM_ZERO = "aresample=async=50:min_hard_comp=0.1:first_pts=0";

/**
 * The mic (input 1) on the shared clock, as an AV Calibration's run opens
 * it: anchored (`micAnchor`), less T0. Audio queued while the camera was
 * opening arrives in one burst stamped "now", before the anchor has settled:
 * dropping the first 1.5 s (padded back with silence by first_pts=0) keeps
 * it from becoming an offset. A take needs no such drop: its mic has been
 * open, and anchored, since the recorder opened.
 */
export const micOnClock = (t0: string, input = "1:a") =>
  `${micAnchor(input)},asetpts=PTS-${t0}/TB,atrim=start=1.5,${MIC_FROM_ZERO}`;

/**
 * AN AV CALIBRATION'S RUN (`calibration-run.ts`): one ffmpeg.exe, the Cam
 * Link and the mic stamped exactly as a Recording Session's camera + mic
 * process stamps them, so a clap's camera time less its mic time is the
 * recording's Mic Offset. The mic goes through ebur128 for the level meter's
 * readings (timed in mic file seconds: it counts the samples the file gets)
 * to `micFile`, raw PCM; the camera, scaled to 640x360 on the GPU (enough to
 * see hands meet), to `cameraFile`. Both tagged as the meter is, so a run
 * left behind can be found and stopped. The 640x360 picture is also read
 * for motion (`MOTION_FILTERS`, as the offline clap pass reads the file),
 * each frame's printed to the log, for the live clap marks (#2121).
 */
export const calibrationCaptureArgs = (o: {
  t0Ms: number;
  camera: string;
  mic: string;
  micFile: string;
  cameraFile: string;
}) => {
  const t0 = (o.t0Ms / 1000).toFixed(3);
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "level+info",
    "-y",
    "-copyts",
    ...WALLCLOCK,
    ...camLinkInput(o.camera),
    ...WALLCLOCK,
    ...micInput(o.mic),
    "-filter_complex",
    [
      `${cameraOnClock(t0)},hwupload_cuda,scale_cuda=640:360,split[cam][camm]`,
      `[camm]hwdownload,format=nv12,${MOTION_FILTERS.join(",")},metadata=mode=print:key=${MOTION_KEY},nullsink`,
      // framelog=info: ebur128 logs each 100 ms reading at info, not verbose.
      `${micOnClock(t0)},ebur128=framelog=info[mic]`,
    ].join(";"),
    "-map",
    "[mic]",
    "-c:a",
    "pcm_s16le",
    ...tagged(METER_TAG),
    o.micFile,
    "-map",
    "[cam]",
    ...nvenc(60),
    ...tagged(METER_TAG),
    ...MKV,
    o.cameraFile,
  ];
};
