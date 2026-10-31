import { liveCameraSize } from "../app/packages/scene-layout";
import { RAW_RELAY, teeWith } from "./relay-tee";

/**
 * THE LIVE STREAM'S FEEDS (spec #2445, ADR 0054): what a streamed Recording
 * Session's own processes send the stream process, beside their files. Only
 * a streamed Recording Session has them; every other one runs today's args
 * exactly, and nothing runs while Matt is not streaming. The long-lived
 * capture and previews never change.
 *
 * Each sits behind tee's dropping fifo, which ignores failure: a stream that
 * is slow, gone or never came up costs only its own packets, and never stops
 * or delays camera.mkv, mic.mkv or screen.mkv. The stream listens on these
 * Windows loopback ports before Record (`stream-side.ts`); a feed that finds
 * no one there retries every half second, so a relaunched stream gets every
 * feed back.
 *
 * Three feeds, not two (#2502): the mic has its own, so a camera feed that
 * overflows or dies never takes the stream's sound with it.
 */

/**
 * Where a Live Stream's three inputs listen: loopback ports picked at Go
 * Live, from a range Windows does not hand out on its own and apart from the
 * capture's relays (`pickRelays`, 23000-28999).
 */
export type StreamFeedPorts = { camera: number; screen: number; mic: number };

export const pickStreamFeedPorts = (): StreamFeedPorts => {
  const base = 29_000 + 3 * Math.floor(Math.random() * 333);
  return { camera: base, screen: base + 1, mic: base + 2 };
};

/** A feed's socket to the stream: cut after 2 s stuck, so the fifo tries again. */
const streamSlave = (port: number) =>
  `[f=matroska:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000&tcp_nodelay=1`;

/**
 * Frames the camera feed may queue: about a second (100 MB at 1080p). A
 * stream that falls further behind loses them, never the writer its time.
 */
const CAMERA_FEED_QUEUE = 30;

/** Packets the mic feed may queue: three seconds of its 20 ms buffers. */
const MIC_FEED_QUEUE = 150;

/** Packets the screen feed may queue: three seconds of 60 fps. */
const SCREEN_FEED_QUEUE = 180;

/** The camera as camera.mkv has it: what the writer reads from the relay. */
const RECORDED_CAMERA = { width: 2560, height: 1440 } as const;

/**
 * The camera feed's picture: the recorded camera scaled to the most any
 * Landscape scene draws of it (`liveCameraSize`, 1920x1080), the size the
 * stream reads it at.
 */
export const STREAM_CAMERA_SIZE = liveCameraSize(RECORDED_CAMERA);

/**
 * THE CAMERA FEED AND THE MIC FEED: two more outputs of the camera writer
 * (`cameraWriterArgs` with `streamPorts`), each behind its own fifo. They
 * carry the very frames camera.mkv gets (CFR 29.97, BT.709) and the very
 * sound mic.mkv gets, raw, in Matroska with their stamps kept: file time, as
 * screen.mkv's, so the stream lines them up with no T0 of its own.
 * Restamping cost the spike ~17% drops and dups.
 *
 * The camera is scaled down on the GPU first (`streamCameraBranch`): the
 * raw 2560x1440 feed was about 1.3 Gbit/s over loopback, and overflowed on
 * Matt's real take (#2502). camera.mkv's own branch is untouched.
 */
export const STREAM_CAMERA_FEED = {
  /** The writer's split: camera.mkv's frames, before the GPU scale. */
  raw: "streamcam_raw",
  video: "streamcam",
  audio: "streammic",
};

/** The writer's stream branch, `[streamcam_raw]` to `[streamcam]`: scaled on CUDA, back in NV12. */
export const streamCameraBranch = () =>
  `[${STREAM_CAMERA_FEED.raw}]hwupload_cuda,scale_cuda=${STREAM_CAMERA_SIZE.width}:${STREAM_CAMERA_SIZE.height}:interp_algo=bicubic,hwdownload,format=nv12[${STREAM_CAMERA_FEED.video}]`;

export const streamCameraFeedOutput = (port: number) => [
  "-map",
  `[${STREAM_CAMERA_FEED.video}]`,
  "-fps_mode",
  "passthrough",
  ...RAW_RELAY,
  ...teeWith(CAMERA_FEED_QUEUE, `${streamSlave(port)}|[f=null:use_fifo=0]-`),
];

export const streamMicFeedOutput = (port: number) => [
  "-map",
  `[${STREAM_CAMERA_FEED.audio}]`,
  "-c:a",
  "pcm_s16le",
  ...teeWith(MIC_FEED_QUEUE, `${streamSlave(port)}|[f=null:use_fifo=0]-`),
];

/**
 * THE SCREEN FEED: screen.mkv written as today, plus a CPU tee of the same
 * encoded packets (1920x1080 H.264 CFR 60), which the stream decodes on
 * NVDEC. Never a second GPU stream in the screen recorder (ADR 0047 point 5,
 * #1992). It needs the global-header flag: without it the tee writes each
 * slave's header before the first packet, Matroska refuses, and screen.mkv
 * itself got no frames (spike, 2026-10-30). An overflow drops the queue and
 * starts again at the next keyframe.
 */
export const STREAM_SCREEN_FEED = {
  output: (file: string, port: number) => [
    "-flags",
    "+global_header",
    "-f",
    "tee",
    "-use_fifo",
    "1",
    "-fifo_options",
    `attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=${SCREEN_FEED_QUEUE}`,
    `[f=matroska:use_fifo=0:cluster_time_limit=1000:flush_packets=1]${file}|${streamSlave(port)}`,
  ],
};
