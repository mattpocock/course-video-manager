import { lineSplitter, type Launcher } from "./launcher";

/**
 * THE LIVE STREAM'S FEEDS (spec #2445, ADR 0054): what a streamed Recording
 * Session's own processes send the stream process, beside their files. Only
 * a streamed Recording Session has them; every other one runs today's args
 * exactly, and nothing runs while Matt is not streaming. The long-lived
 * capture and previews never change.
 *
 * Each feed is a CPU tee of the very packets a file gets, already encoded:
 * screen.mkv's H.264, camera.mkv's H.264 and mic.mkv's AAC. Nothing is
 * encoded twice, and the stream decodes them (the pictures on NVDEC). The
 * camera feed was raw 2560x1440 NV12 plus the mic, about 1.3 Gbit/s over
 * loopback: on Matt's real take, and on the synthetic rig, it overflowed
 * within seconds and then died, taking the stream's only sound with it
 * (#2502). The screen's tee, a few Mbit/s, never overflowed. The mic is
 * its own feed, so a camera that drops never takes the sound.
 *
 * Each sits behind tee's dropping fifo, which ignores failure: a stream that
 * is slow, gone or never came up costs only its own packets, and never stops
 * or delays camera.mkv, mic.mkv or screen.mkv. The stream listens on these
 * Windows loopback ports before Record (`stream-side.ts`); a feed that finds
 * no one there retries every half second, so a relaunched stream gets every
 * feed back. An overflow drops the queue and starts again at the next
 * keyframe: the take's process says so (`FEED_OVERFLOW`), and the stream
 * side turns the health amber (`stream-side.ts`, #2525).
 */

/**
 * What a take's process prints when one of its feeds overflows: its tee's
 * fifo, full because the stream fell behind, dropped its queue.
 */
export const FEED_OVERFLOW = /FIFO queue full/;

/** A feed whole again: no overflow for this long, and the health is no longer amber. */
export const FEED_RECOVERED_MS = 5_000;

/**
 * A streamed take's launcher: each process it launches (the camera writer,
 * the screen recorder) is heard for `FEED_OVERFLOW` on its stderr, beside
 * whatever else reads it. Only told; the take never waits on it.
 */
export const hearingFeedOverflows =
  (launch: Launcher, onOverflow: () => void): Launcher =>
  (l) => {
    const p = launch(l);
    p.onStderr(
      lineSplitter((line) => {
        if (FEED_OVERFLOW.test(line)) onOverflow();
      })
    );
    return p;
  };

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

/**
 * A feed's socket to the stream: cut after 5 s stuck, so the fifo tries
 * again: by then the stream side has stopped a stream that stopped
 * (`STREAM_STALL_MS`), which resets the socket at once.
 */
const streamSlave = (port: number) =>
  `[f=matroska:onfail=ignore]tcp://127.0.0.1:${port}?timeout=5000000&tcp_nodelay=1`;

/**
 * Packets each feed may queue: about four seconds of each, a few MB of
 * encoded packets: more than the stream's ~1.2 s lag behind the take and its
 * start-up. Not more: a relaunched stream is sent the queue first, and
 * every packet of it is older than its picture.
 */
const FEED_QUEUE = { screen: 240, camera: 120, mic: 200 } as const;

/**
 * A file written as ever, with its packets teed to the stream. It needs the
 * global-header flag: without it the tee writes each slave's header before
 * the first packet, Matroska refuses, and the file itself got no frames
 * (spike, 2026-10-30). Never a second GPU stream in a take's process (ADR
 * 0047 point 5, #1992): the tee is on the CPU, after the encoder.
 */
const teedFile = (file: string, port: number, queue: number): string[] => [
  "-flags",
  "+global_header",
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  `attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=${queue}`,
  `[f=matroska:use_fifo=0:cluster_time_limit=1000:flush_packets=1]${file}|${streamSlave(port)}`,
];

/** THE SCREEN FEED: screen.mkv's packets (1920x1080 H.264 CFR 60). */
export const screenFeedOutput = (file: string, port: number) =>
  teedFile(file, port, FEED_QUEUE.screen);

/** THE CAMERA FEED: camera.mkv's packets (2560x1440 H.264 CFR 29.97, BT.709), in file time. */
export const cameraFeedOutput = (file: string, port: number) =>
  teedFile(file, port, FEED_QUEUE.camera);

/** THE MIC FEED: mic.mkv's packets (AAC), in file time, raw as the file is. */
export const micFeedOutput = (file: string, port: number) =>
  teedFile(file, port, FEED_QUEUE.mic);
