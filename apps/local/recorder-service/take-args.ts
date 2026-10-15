import {
  silenceRule,
  silencedetectFilter,
  type SilenceLength,
} from "../app/silence-detection-constants";
import {
  BT709,
  CAMERA_CFR,
  FILE_NAMES,
  MIC_FROM_ZERO,
  MKV,
  nvenc,
  relayInput,
  WALLCLOCK,
} from "./capture-args";

/**
 * A TAKE'S OWN PROCESSES (#2207): the camera writer, which writes camera.mkv
 * and mic.mkv from the camera capture's writer relay (`capture-args.ts`),
 * armed before Record and started by it; and the screen recorder, started
 * at Record.
 */

/**
 * How far past the wall clock an armed writer puts every frame it gets
 * (seconds, about 317 years): before Record, everything it reads is that far
 * before t=0, so fps and atrim drop it.
 */
const UNARMED_T0 = "1e10";

/**
 * A frame reaching the writer more than this many seconds after the one
 * before it, inside a take, is logged as a gap ("[warning] -0.233000",
 * negative so it never reads as a mic stall): about two frames missing, from
 * the Cam Link or the relay.
 */
export const FRAME_GAP_SECONDS = 0.1;

/**
 * The same for the screen recorder at 60 fps (#2214): a frame more than
 * this after the one before is about two slots ddagrab missed.
 */
export const SCREEN_FRAME_GAP_SECONDS = 0.05;

/**
 * A filter that passes every frame and logs, at warning, each gap longer
 * than `seconds` once the take's clock has started ("[warning] -0.233000",
 * negative so it never reads as a mic stall). The writer and the screen
 * recorder both count lost frames from it (recording-session.ts).
 */
const gapLogger = (seconds: number) =>
  `select='if(gte(t,0)*gte(prev_selected_t,0)*gt(t-prev_selected_t,${seconds}),print(-(t-prev_selected_t),24));1'`;

/**
 * -progress and keyboard period of the writer, in seconds: how often it
 * looks for Record's T0 on its stdin (ffmpeg reads a key at most every 0.1
 * s). Frames stamped T0 or later that pass before T0 arrives are dropped, so
 * this bounds how late after Record the files' first real frame and sound
 * can be (the CFR filter repeats that frame back to T0, aresample pads the
 * mic with silence).
 */
export const WRITER_STATS_PERIOD = 0.05;

/**
 * THE CAMERA WRITER for one take (#2207): listens for the camera capture's
 * writer relay, and writes camera.mkv (CFR 29.97, BT.709, NVENC as ever) and
 * mic.mkv (AAC), with silencedetect on the very audio mic.mkv gets. Armed
 * before Record, it reads the relay and drops everything (`UNARMED_T0`):
 * nothing reaches an encoder, so neither file gets a byte. Record writes
 * `takeStartCommand(T0)` to its stdin, which ffmpeg queues on both clocks'
 * filters (`setpts@t0`, `asetpts@t0`) to apply from the first frame stamped
 * T0 or later that reaches them: the files' clock starts at T0, and their
 * first real frame and sound come at most a keyboard period after it
 * (`WRITER_STATS_PERIOD`), less however far the writer runs behind.
 */
export const cameraWriterArgs = (o: {
  relayPort: number;
  tag: string;
  silenceLength: SilenceLength;
  /** The silence threshold silencedetect cuts with, in dB. */
  thresholdDb: number;
}) => {
  // silencedetect reads the very audio mic.mkv gets, so its times are mic
  // file time; anullsink ends that branch inside the graph.
  const silence = silencedetectFilter(
    silenceRule(o.silenceLength, o.thresholdDb)
  );
  const gap = gapLogger(FRAME_GAP_SECONDS);
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "level+info",
    "-y",
    "-progress",
    "pipe:1",
    "-stats_period",
    String(WRITER_STATS_PERIOD),
    "-copyts",
    ...relayInput("writer", o.relayPort),
    "-filter_complex",
    [
      `[0:v]setpts@t0=PTS-${UNARMED_T0}/TB,${gap},${CAMERA_CFR},${BT709}[cam]`,
      `[0:a]asetpts@t0=PTS-${UNARMED_T0}/TB,atrim=start=0,${MIC_FROM_ZERO},asplit=2[mic][sd]`,
      `[sd]${silence},anullsink`,
    ].join(";"),
    "-map",
    "[cam]",
    ...nvenc(60),
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILE_NAMES.camera,
    "-map",
    "[mic]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILE_NAMES.mic,
  ];
};

/**
 * What Record writes to an armed writer's stdin: ffmpeg's `C` (queue a
 * command for every filter that takes it, from a time on) sets both clocks
 * to wall time less T0 from the first frame stamped T0 or later. Only
 * `setpts@t0` and `asetpts@t0` take `expr` in the writer.
 */
export const takeStartCommand = (t0Ms: number) => {
  const t0 = (t0Ms / 1000).toFixed(3);
  return `Call ${t0} expr PTS-${t0}/TB\n`;
};

/**
 * THE SCREEN RECORDER for one take: ddagrab on the screen, wall time less
 * T0, CFR 60 from exactly t=0, NV12 on the GPU, NVENC. Each gap in
 * ddagrab's frames is logged (`SCREEN_FRAME_GAP_SECONDS`). dup_frames=1: with 0,
 * ddagrab emits nothing while the screen is static, which stalls the graph.
 * Its pacing needs the 1 ms timer the service raises right after start
 * (timer-resolution.ps1).
 */
/**
 * No -progress: nobody reads the screen recorder's stdout, and an unread
 * pipe fills in a few minutes, after which ffmpeg blocks on its next write
 * and never sees Stop's `q` (it was killed 20 s later, its file unfinished).
 */
const SCREEN_HEAD = [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+info",
  "-y",
  "-copyts",
];

export const screenRecorderArgs = (o: {
  t0Ms: number;
  /** Put in the file's metadata and the command line, so the process can be found by it. */
  tag: string;
  /** ddagrab's output_idx: the DELL, or a Short's Spacedesk display. */
  screenIndex: number;
}) => {
  const t0 = (o.t0Ms / 1000).toFixed(3);
  return [
    ...SCREEN_HEAD,
    ...WALLCLOCK,
    "-f",
    "lavfi",
    "-i",
    `ddagrab=output_idx=${o.screenIndex}:framerate=60:dup_frames=1:draw_mouse=1,settb=AVTB`,
    "-filter_complex",
    `[0:v]setpts=PTS-${t0}/TB,${gapLogger(SCREEN_FRAME_GAP_SECONDS)},fps=60:start_time=0,${BT709},scale_d3d11=format=nv12[scr]`,
    "-map",
    "[scr]",
    ...nvenc(120),
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILE_NAMES.screen,
  ];
};
