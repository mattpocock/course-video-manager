import type { MicEq } from "@cvm/core/features/videos/recorder";
import type { Scene } from "../app/packages/scene-layout";
import { quitProcess } from "./camera";
import { lineSplitter, type LaunchedProcess, type Launcher } from "./launcher";
import { STREAM_IDLE, type StreamStatus } from "./stream-protocol";
import { streamArgs, streamSceneCommand, STREAM_TAG } from "./stream-args";
import type { StreamFeedPorts } from "./stream-feeds";

/**
 * THE STREAM SIDE (spec #2445, ADR 0054): the one Live Stream process, built
 * like the screen side and the level meter. It starts at Go Live, before the
 * streamed Recording Session's Record, and ends with it.
 *
 * Raw footage first: nothing here stops a take, releases the camera or
 * restarts a preview. A stream process that quits, stalls or loses YouTube
 * only ends (or, later, restarts) itself; Record never waits on it past
 * `STREAM_LISTEN_BOUND_MS`.
 *
 * The Stream Key is on its command line and nowhere else: every line it
 * prints is scrubbed of it before the service's log sees it.
 *
 * It shows the service's own scene: a stream process starts on the scene
 * of the moment, and every switch goes to the running one as a runtime
 * command on its stdin (`streamSceneCommand`), so a switch never restarts it.
 */

/**
 * How long Record waits for the stream process to be listening for its
 * feeds. A stream that is not up by then misses the take's first moments
 * (its feeds retry every half second); the take never waits longer.
 */
export const STREAM_LISTEN_BOUND_MS = 1_500;

/** How long `q` gets before the stream process is killed. */
const STREAM_QUIT_TIMEOUT_MS = 5_000;

/** Lines of its stderr (warnings and errors only) logged per minute, at most. */
const STDERR_LINES_PER_MINUTE = 20;

/** What ffmpeg prints first, before it opens (and listens on) its inputs. */
const BANNER = /ffmpeg version/;

/** The Stream Key, wherever a line names it. */
export const redactStreamKey = (key: string) => (text: string) =>
  key ? text.split(key).join("<stream key>") : text;

export type StreamStart = {
  ports: StreamFeedPorts;
  /** The service's scene at Go Live; switches come by `switchScene`. */
  scene: Scene;
  micOffsetMs: number;
  micEq: MicEq;
  /** The ingest address the key goes after (`YOUTUBE_INGEST`). */
  ingest: string;
  streamKey: string;
};

export const createStreamSide = (o: {
  launch: Launcher;
  /** The Live Stream's status, whenever it changes. */
  onStatus: (status: StreamStatus) => void;
  /** `STREAM_LISTEN_BOUND_MS` (tests). */
  listenBoundMs?: number;
}) => {
  let status: StreamStatus = STREAM_IDLE;
  let running: { process: LaunchedProcess; ending: boolean } | undefined;
  /** The service's scene, which every stream process launched starts on. */
  let scene: Scene | undefined;
  /** Quits under way, so the service's close waits for them. */
  const quitting = new Set<Promise<void>>();

  const set = (next: StreamStatus) => {
    status = next;
    o.onStatus(next);
  };

  /** Its stderr, scrubbed, into the service's log: a few lines a minute. */
  const logLines = (redact: (text: string) => string) => {
    let logged = 0;
    let windowStart = Date.now();
    return lineSplitter((raw) => {
      const line = redact(raw);
      if (!/\[(warning|error|fatal)\]/.test(line)) return;
      if (Date.now() - windowStart > 60_000) {
        windowStart = Date.now();
        logged = 0;
      }
      logged += 1;
      if (logged <= STDERR_LINES_PER_MINUTE)
        console.error(`recorder: Live Stream: ${line}`);
      else if (logged === STDERR_LINES_PER_MINUTE + 1)
        console.error(
          "recorder: Live Stream: (more lines this minute left out)"
        );
    });
  };

  const start = async (s: StreamStart): Promise<void> => {
    if (running) throw new Error("A Live Stream is already running.");
    const redact = redactStreamKey(s.streamKey);
    set({ kind: "starting" });
    scene = s.scene;
    const p = o.launch({
      tool: "ffmpeg",
      args: streamArgs({
        ports: s.ports,
        scene,
        micOffsetMs: s.micOffsetMs,
        micEq: s.micEq,
        url: `${s.ingest}/${s.streamKey}`,
      }),
      cwd: "/mnt/c",
    });
    const self = { process: p, ending: false };
    running = self;
    p.onStderr(logLines(redact));
    const listening = new Promise<void>((resolve) => {
      p.onStderr((chunk) => {
        if (!BANNER.test(chunk)) return;
        if (running === self && status.kind === "starting")
          set({ kind: "connecting" });
        resolve();
      });
    });
    // -progress: once frames go out, it is live.
    p.onStdout(
      lineSplitter((line) => {
        const frame = line.match(/^frame=(\d+)/);
        if (
          frame &&
          Number(frame[1]) > 0 &&
          running === self &&
          status.kind === "connecting"
        )
          set({ kind: "live" });
      })
    );
    void p.exited.then((code) => {
      if (running !== self) return;
      running = undefined;
      if (self.ending) return;
      console.error(
        `recorder: the Live Stream process quit (exit ${code}); the recording carries on`
      );
      set({
        kind: "ended",
        reason: `The stream process quit (exit ${code}). The recording carries on: End Stream to stop it.`,
      });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = o.listenBoundMs ?? STREAM_LISTEN_BOUND_MS;
    const inTime = await Promise.race([
      listening.then(() => true),
      p.exited.then(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), bound);
      }),
    ]);
    clearTimeout(timer);
    if (!inTime)
      console.error(
        `recorder: the Live Stream was not listening ${bound} ms after Go Live; recording anyway`
      );
  };

  /** Ends the Live Stream, saying why; nothing waits for the process to go. */
  const end = (reason: string) => {
    const r = running;
    if (status.kind !== "idle" && status.kind !== "ended")
      set({ kind: "ended", reason });
    if (!r || r.ending) return;
    r.ending = true;
    const quit = quitProcess(r.process, {
      launch: o.launch,
      tag: STREAM_TAG,
      timeoutMs: STREAM_QUIT_TIMEOUT_MS,
    }).finally(() => {
      if (running === r) running = undefined;
      quitting.delete(quit);
    });
    quitting.add(quit);
  };

  /** The service's scene changed: the running stream shows it at once. */
  const switchScene = (next: Scene) => {
    scene = next;
    if (running && !running.ending)
      running.process.writeStdin(streamSceneCommand(next));
  };

  return {
    start,
    end,
    switchScene,
    status: () => status,
    /** Whether a Live Stream was started and has not ended. */
    live: () => status.kind !== "idle" && status.kind !== "ended",
    /** Ends any Live Stream; done once its process has gone. */
    close: async (reason: string) => {
      end(reason);
      await Promise.all([...quitting]);
    },
  };
};
