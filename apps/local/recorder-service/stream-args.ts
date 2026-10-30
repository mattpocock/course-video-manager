import type { MicEq } from "@cvm/core/features/videos/recorder";
import { STREAM_GAIN_DB } from "../app/features/video-editor/constants";
import { micEqFilters } from "../app/packages/mic-eq";
import {
  liveSceneFilterGraph,
  liveSceneSwitch,
  type Scene,
} from "../app/packages/scene-layout";
import type { StreamFeedPorts } from "./stream-feeds";

/**
 * THE LIVE STREAM PROCESS'S ARGUMENTS (spec #2445, ADR 0054). One
 * ffmpeg.exe that holds no device and writes no file: it listens for a
 * streamed Recording Session's two feeds (`stream-feeds.ts`), draws the
 * Landscape scene (`liveSceneFilterGraph`) on CUDA, encodes it on NVENC and
 * pushes it to YouTube behind a fifo that retries without limit. Every
 * setting is a constant here; only the ports, the scene, the Mic Offset, the
 * Mic EQ and the ingest address with its Stream Key come from Go Live, and nothing
 * rides in an environment variable.
 */

/** In its command line, so one a dead service left can be stopped (`stop-recorders.ps1`). */
export const STREAM_TAG = "cvm-recorder-stream";

/**
 * YouTube's RTMPS ingest: the Stream Key goes after it, never over the wire
 * in the clear. The service may be given another (a local sink, in the
 * scorecard); nothing else ever is.
 */
export const YOUTUBE_INGEST = "rtmps://a.rtmps.youtube.com:443/live2";

/** What the stream reads: the screen recorder's picture, the camera writer's. */
export const STREAM_SOURCES = {
  screen: { width: 1920, height: 1080 },
  camera: { width: 2560, height: 1440 },
} as const;

/** 1080p60 CBR on NVENC (Matt, 2026-10-30): no CPU encoder, never 30 fps. */
export const STREAM_ENCODE = {
  fps: 60,
  videoKbps: 9_000,
  /** A keyframe every 2 s. */
  gopFrames: 120,
  audioKbps: 160,
} as const;

/**
 * -progress and keyboard period, in seconds: how often the stream says how
 * it is doing, and looks for a scene switch on its stdin (ffmpeg reads a key
 * at most every 0.1 s, and only once a period). A switch shows within
 * about a tenth of a second.
 */
export const STREAM_PROGRESS_SECONDS = 0.05;

/**
 * What starts each encoded packet's line on its stderr, with the packet's
 * size: -progress has no size for a tee, so the health line's bitrate is
 * added up from these (`stream-health.ts`).
 */
export const STREAM_PACKET_LINE = "cvm-packet ";

/**
 * Packets the push may queue while YouTube is unreachable: about three
 * seconds. On overflow the fifo drops them and starts again at a keyframe.
 */
const PUSH_QUEUE = 300;

/**
 * The Mic Offset on the mic (the mic file runs ahead of the picture by it,
 * `protocol.ts`, TIME BASE): later by a delay, earlier by a trim.
 */
const micOnPicture = (micOffsetMs: number) => {
  if (micOffsetMs >= 0) return `adelay=${micOffsetMs}:all=1`;
  const s = (-micOffsetMs / 1000).toFixed(3);
  return `atrim=start=${s},asetpts=PTS-${s}/TB`;
};

/**
 * A brick wall at −2 dBFS for the rare peaks the static gain pushes over
 * (about 4 dB at most). `latency=1` gives back its 5 ms lookahead, so the
 * mic stays in sync with the picture; `level=0` adds no make-up gain.
 */
const STREAM_LIMITER =
  "alimiter=limit=0.794:attack=5:release=50:level=0:latency=1";

/**
 * THE STREAM'S SOUND (spec #2445, stories 31–35): the export's sound,
 * live. Mic Offset → Mic EQ (the export's own filter) → a static
 * `STREAM_GAIN_DB` → the limiter. No loudness rider or compressor: they
 * hold seconds of audio or change the sound. Only in the stream process:
 * the camera writer's mic, and so mic.mkv, stay raw.
 */
const streamSound = (micOffsetMs: number, micEq: MicEq) => [
  micOnPicture(micOffsetMs),
  ...micEqFilters(micEq),
  `volume=${STREAM_GAIN_DB}dB`,
  STREAM_LIMITER,
];

/** A listening loopback input: the feed connects to it. */
const feedInput = (port: number, probesize: number) => [
  "-probesize",
  String(probesize),
  "-analyzeduration",
  "0",
  "-f",
  "matroska",
  "-i",
  `tcp://127.0.0.1:${port}?listen=1&tcp_nodelay=1`,
];

/**
 * THE CARD FEED'S INPUT (#2461, `card-feed.ts`): raw yuva420p at 60 fps from
 * the service's loopback listener, which the stream connects to. Its frames
 * are stamped by their count, so frame n is picture time n/60 under
 * `-copyts`: the feed's own clock, never arrival time.
 */
const cardInput = (card: StreamCard) => [
  "-probesize",
  "32",
  "-analyzeduration",
  "0",
  "-f",
  "rawvideo",
  "-pixel_format",
  "yuva420p",
  "-video_size",
  `${card.width}x${card.height}`,
  "-framerate",
  String(STREAM_ENCODE.fps),
  "-i",
  `tcp://127.0.0.1:${card.port}?tcp_nodelay=1`,
];

/** The Chat Highlight card's frames: where they come from, and their size. */
export type StreamCard = { port: number; width: number; height: number };

/**
 * Where the card's frame sits on the picture: at the bottom left, its
 * settled card 48 px in from the left and 60 px up (the still's shadow
 * margin, plus the travel room under it), clear of the Code scene's camera.
 */
const cardPlace = (card: StreamCard) => ({
  x: 0,
  y: STREAM_SOURCES.screen.height - card.height,
});

/**
 * What a scene switch writes to the running stream process's stdin: ffmpeg's
 * `C`, the writer's T0 mechanism (`takeStartCommand`), sent now (time -1)
 * rather than queued: the graph's frames are on the canvas's clock, not the
 * Recording Session's, so there is no time to queue it for.
 */
export const streamSceneCommand = (scene: Scene) => {
  const c = liveSceneSwitch(scene);
  return `C${c.target} -1 ${c.command} ${c.arg}\n`;
};

export const streamArgs = (o: {
  ports: StreamFeedPorts;
  /** The scene it starts on: the service's scene at its launch. */
  scene: Scene;
  micOffsetMs: number;
  /** The saved Mic EQ, as read at Go Live. */
  micEq: MicEq;
  /** The ingest address with the Stream Key on the end: only ever here. */
  url: string;
  card: StreamCard;
  /**
   * Where its picture starts, in the Recording Session's file time (s): 0
   * at Go Live, before Record; a relaunch starts where the feeds are now.
   */
  startSeconds?: number;
}) => {
  const graph = [
    liveSceneFilterGraph({
      sources: STREAM_SOURCES,
      inputs: { screen: "0:v", camera: "1:v" },
      scene: o.scene,
      output: "v",
      card: { input: "2:v", ...cardPlace(o.card) },
      canvasStartSeconds: o.startSeconds,
    }),
    `[1:a]${[...streamSound(o.micOffsetMs, o.micEq), "aresample=async=1000"].join(",")}[a]`,
  ].join(";");
  const kbps = `${STREAM_ENCODE.videoKbps}k`;
  return [
    // No -hide_banner, and info: the banner (an info line) is how the
    // service hears it has started, just before it listens for its first
    // feed (`stream-side.ts`). Only warnings and errors reach the log.
    "-nostats",
    "-loglevel",
    "level+info",
    "-progress",
    "pipe:1",
    "-stats_period",
    String(STREAM_PROGRESS_SECONDS),
    // Both feeds are in the Recording Session's file time: kept as they are.
    "-copyts",
    "-init_hw_device",
    "cuda=cu:0",
    "-filter_hw_device",
    "cu",
    // The screen recorder's H.264, decoded on NVDEC straight onto CUDA.
    "-hwaccel",
    "cuda",
    "-hwaccel_output_format",
    "cuda",
    "-hwaccel_device",
    "cu",
    ...feedInput(o.ports.screen, 100_000),
    ...feedInput(o.ports.camera, 32),
    ...cardInput(o.card),
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-fps_mode",
    "cfr",
    "-r",
    String(STREAM_ENCODE.fps),
    "-c:v",
    "h264_nvenc",
    "-preset",
    "p5",
    "-tune",
    "hq",
    "-rc",
    "cbr",
    "-b:v",
    kbps,
    "-maxrate",
    kbps,
    "-bufsize",
    `${STREAM_ENCODE.videoKbps * 2}k`,
    "-profile:v",
    "high",
    "-bf",
    "2",
    "-g",
    String(STREAM_ENCODE.gopFrames),
    "-keyint_min",
    String(STREAM_ENCODE.gopFrames),
    "-c:a",
    "aac",
    "-b:a",
    `${STREAM_ENCODE.audioKbps}k`,
    "-ar",
    "48000",
    "-stats_enc_post",
    "pipe:2",
    "-stats_enc_post_fmt",
    `${STREAM_PACKET_LINE}{size}`,
    "-metadata",
    `comment=${STREAM_TAG}`,
    // FLV needs its headers up front behind the tee.
    "-flags",
    "+global_header",
    "-f",
    "tee",
    "-use_fifo",
    "1",
    "-fifo_options",
    `attempt_recovery=1:recover_any_error=1:recovery_wait_time=1:max_recovery_attempts=0:restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=${PUSH_QUEUE}`,
    `[f=flv:onfail=ignore]${o.url}|[f=null:use_fifo=0]-`,
  ];
};
