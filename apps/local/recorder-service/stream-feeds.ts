import { RAW_RELAY, teeWith } from "./relay-tee";

/**
 * THE LIVE STREAM'S FEEDS (spec #2445, ADR 0054): what a streamed Recording
 * Session's own processes send the stream process, beside their files. Only
 * a streamed Recording Session has them; every other one runs today's args
 * exactly, and nothing runs while Matt is not streaming. The long-lived
 * capture and previews never change.
 *
 * Both sit behind tee's dropping fifo, which ignores failure: a stream that
 * is slow, gone or never came up costs only its own packets, and never stops
 * or delays camera.mkv, mic.mkv or screen.mkv. The stream listens on these
 * Windows loopback ports before Record (`stream-side.ts`); a feed that finds
 * no one there retries every half second.
 */

/**
 * Where a Live Stream's two inputs listen: two loopback ports picked at Go
 * Live, from a range Windows does not hand out on its own and apart from the
 * capture's relays (`pickRelays`, 23000-28999).
 */
export type StreamFeedPorts = { camera: number; screen: number };

export const pickStreamFeedPorts = (): StreamFeedPorts => {
  const base = 29_000 + 2 * Math.floor(Math.random() * 500);
  return { camera: base, screen: base + 1 };
};

/** A feed's socket to the stream: cut after 2 s stuck, so the fifo tries again. */
const streamSlave = (port: number) =>
  `[f=matroska:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000&tcp_nodelay=1`;

/**
 * Packets the camera + mic feed may queue (frames and 20 ms mic buffers):
 * about two seconds. The spike's 24 overflowed 31 times in 200 s.
 */
const CAMERA_FEED_QUEUE = 160;

/** Packets the screen feed may queue: three seconds of 60 fps. */
const SCREEN_FEED_QUEUE = 180;

/**
 * THE CAMERA + MIC FEED: the camera writer's second output (`cameraWriterArgs`
 * with a `streamPort`). It carries the very frames camera.mkv gets (CFR
 * 29.97, BT.709) and the very sound mic.mkv gets, raw, in Matroska with
 * their stamps kept: file time, as screen.mkv's, so the stream lines the two
 * up with no T0 of its own. Restamping cost the spike ~17% drops and dups.
 */
export const STREAM_CAMERA_FEED = { video: "streamcam", audio: "streammic" };

export const streamCameraFeedOutput = (port: number) => [
  "-map",
  `[${STREAM_CAMERA_FEED.video}]`,
  "-map",
  `[${STREAM_CAMERA_FEED.audio}]`,
  "-fps_mode",
  "passthrough",
  ...RAW_RELAY,
  "-c:a",
  "pcm_s16le",
  ...teeWith(CAMERA_FEED_QUEUE, `${streamSlave(port)}|[f=null:use_fifo=0]-`),
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
