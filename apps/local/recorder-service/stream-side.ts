import type { MicEq } from "@cvm/core/features/videos/recorder";
import type { Scene } from "../app/packages/scene-layout";
import { quitProcess } from "./camera";
import { lineSplitter, type LaunchedProcess, type Launcher } from "./launcher";
import {
  STREAM_IDLE,
  type StreamHealth,
  type StreamStatus,
} from "./stream-protocol";
import {
  streamArgs,
  streamSceneCommand,
  STREAM_TAG,
  type StreamCard,
} from "./stream-args";
import { FEED_RECOVERED_MS, type StreamFeedPorts } from "./stream-feeds";
import {
  NO_HEALTH,
  readStreamHealth,
  type ProcessHealth,
} from "./stream-health";

/**
 * THE STREAM SIDE (spec #2445, ADR 0054): the one Live Stream process, built
 * like the screen side and the level meter. It starts at Go Live, before the
 * streamed Recording Session's Record, and ends with it.
 *
 * Raw footage first: nothing here stops a take, releases the camera or
 * restarts a preview. A stream process that quits, stalls or loses YouTube
 * only ever restarts itself; Record never waits on it past
 * `STREAM_LISTEN_BOUND_MS`.
 *
 * It reconnects for ever, until End Stream (Matt, 2026-10-30), at two
 * levels: inside the process its push's fifo retries without limit
 * (`streamArgs`); outside it, a process that quits or stalls is launched
 * again, after a wait that doubles, from the very `StreamStart` Go Live gave
 * it (the Mic EQ and Mic Offset are read once) on the service's scene of the
 * moment. It listens on the same ports, and the feeds' fifos connect again.
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

/**
 * No new frame for this long and the stream process has stalled: it is
 * stopped and launched again. Before its first frame it gets four times as
 * long (its feeds come at Record). A feed that ends or stalls holds every
 * frame back (the camera's overlays end with it, `-shortest` ends the
 * picture with the sound), so this is how a dead feed is heard (#2502).
 */
export const STREAM_STALL_MS = 5_000;

/** The first wait before a relaunch; each next one doubles, up to the last. */
const RELAUNCH_WAITS_MS = { first: 250, last: 8_000 };

/**
 * How far ahead of the feeds' file time a relaunched stream's picture
 * starts: the time it takes to come up and for its feeds to connect again.
 * Their frames before it are dropped; a picture that started behind them
 * would be drawn as fast as it could until it caught up (seen on ffmpeg.exe
 * 8.0.1: 96 fps for the rest of the take).
 */
const RELAUNCH_LEAD_S = 3;

/** A process live this long was healthy: the next relaunch waits the first wait again. */
const HEALTHY_MS = 30_000;

/** How long `q` gets before the stream process is killed. */
const STREAM_QUIT_TIMEOUT_MS = 5_000;

/**
 * How long Go Live waits for the last Live Stream's process to quit, after
 * End Stream: its own `q` and kill (`STREAM_QUIT_TIMEOUT_MS`), and a little
 * more for its Windows side. Only past it is Go Live refused.
 */
export const LAST_STREAM_QUIT_BOUND_MS = STREAM_QUIT_TIMEOUT_MS + 3_000;

/** Why Go Live is refused when the last stream process outlived that bound. */
export const LAST_STREAM_STILL_QUITTING =
  "The last Live Stream's process has not quit yet: press Go Live again in a moment.";

/** How long a stalled one gets: it is likely deaf to `q`. */
const STALLED_QUIT_TIMEOUT_MS = 1_000;

/** Lines of its stderr (warnings and errors only) logged per minute, at most. */
const STDERR_LINES_PER_MINUTE = 20;

/** What ffmpeg prints first, before it opens (and listens on) its inputs. */
const BANNER = /ffmpeg version/;

/**
 * The push's fifo lost YouTube: it closed the FLV (its trailer's warning) or
 * a retry failed. Its retries go on, without limit.
 */
const PUSH_LOST = /\[fifo @ [^\]]*\] \[error\]|Failed to update header/;

/** The push's fifo is through to YouTube again. */
const PUSH_BACK = /Recovery successful/;

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
  /** The Chat Highlight card feed it reads (`card-feed.ts`). */
  card: StreamCard;
};

/** One stream process, of the Live Stream's one or more. */
type Running = {
  process: LaunchedProcess;
  ending: boolean;
  /** It has encoded a picture. */
  framed: boolean;
  /** Its push has lost YouTube and not got it back. */
  pushLost: boolean;
  /** When it went live, if it has. */
  liveAt?: number;
  /** Done once it has gone, Windows side too, when it had to be stopped. */
  gone: Promise<void>;
};

/** Its stderr's warnings and errors, scrubbed, into the service's log: a few lines a minute. */
const stderrLog = (redact: (text: string) => string) => {
  let logged = 0;
  let windowStart = Date.now();
  return (line: string) => {
    if (!/\[(warning|error|fatal)\]/.test(line)) return;
    if (Date.now() - windowStart > 60_000) {
      windowStart = Date.now();
      logged = 0;
    }
    logged += 1;
    if (logged <= STDERR_LINES_PER_MINUTE)
      console.error(`recorder: Live Stream: ${redact(line)}`);
    else if (logged === STDERR_LINES_PER_MINUTE + 1)
      console.error("recorder: Live Stream: (more lines this minute left out)");
  };
};

export const createStreamSide = (o: {
  launch: Launcher;
  /** The Live Stream's status, whenever it changes. */
  onStatus: (status: StreamStatus) => void;
  /** Its health: about once a second while a process runs, and at each reconnect. */
  onHealth: (health: StreamHealth) => void;
  /** How long Record waits for it to listen (`STREAM_LISTEN_BOUND_MS`). */
  listenBoundMs: number;
  /** No new frame this long and a process has stalled (`STREAM_STALL_MS`). */
  stallMs: number;
  /** The streamed Recording Session's file time now (s), once it records. */
  fileTime: () => number | null;
  /** A process is launching, its picture starting at this file time (s). */
  onLaunch: (startSeconds: number) => void;
  /** Wall-clock ms, for how long ago a feed last overflowed. */
  now: () => number;
}) => {
  const stallMs = o.stallMs;
  let status: StreamStatus = STREAM_IDLE;
  let running: Running | undefined;
  /** What Go Live started it with, until it ends: every relaunch uses it. */
  let held: { start: StreamStart; log: (line: string) => void } | undefined;
  /** The service's scene, which every stream process launched starts on. */
  let scene: Scene | undefined;
  let reconnects = 0;
  /** The take's feeds' overflows since Go Live, and when the last was. */
  let feedOverflows = 0;
  let lastOverflowAt = -Infinity;
  let health: ProcessHealth = NO_HEALTH;
  /** Relaunches since a process was last healthy: how long the next waits. */
  let relaunches = 0;
  let relaunchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Quits under way, so the service's close waits for them. */
  const quitting = new Set<Promise<void>>();

  const set = (next: StreamStatus) => {
    if (status.kind === next.kind && next.kind !== "ended") return;
    status = next;
    o.onStatus(next);
  };
  const feedsDropping = () => o.now() - lastOverflowAt < FEED_RECOVERED_MS;
  const sendHealth = () =>
    o.onHealth({
      ...health,
      reconnects,
      feedOverflows,
      feedsDropping: feedsDropping(),
    });

  /**
   * A FEED OVERFLOWED (#2525): the stream fell behind a take's process, and
   * that feed's fifo dropped its queue, starting again at the next keyframe.
   * The encoder's numbers stay green through it, so it turns the health
   * amber at once, and stays so until no feed has overflowed for
   * `FEED_RECOVERED_MS`. Its fifo recovers on its own; nothing is relaunched,
   * and the take never hears of it. Logged once per run of overflows.
   */
  const feedOverflowed = () => {
    if (!held) return;
    const wasDropping = feedsDropping();
    feedOverflows += 1;
    lastOverflowAt = o.now();
    if (!wasDropping)
      console.error(
        "recorder: Live Stream: a take's feed to it overflowed (the stream fell behind it): packets dropped until its next keyframe; the recording carries on"
      );
    sendHealth();
  };
  /** It lost YouTube, or its process: one more reconnect, said at once. */
  const reconnecting = () => {
    reconnects += 1;
    set({ kind: "reconnecting" });
    sendHealth();
  };

  /** Stops one stream process: `q`, then a kill, Windows side too. */
  const quit = (r: Running, timeoutMs: number) => {
    const done: Promise<void> = quitProcess(r.process, {
      launch: o.launch,
      tag: STREAM_TAG,
      timeoutMs,
    }).finally(() => quitting.delete(done));
    quitting.add(done);
    return done;
  };

  /** Launches it again after its wait, unless the Live Stream ended first. */
  const relaunchLater = (wait: number) => {
    const h = held;
    if (!h) return;
    relaunchTimer = setTimeout(() => {
      relaunchTimer = undefined;
      if (held !== h || running) return;
      // Its picture starts where the feeds will be once it is up.
      const now = o.fileTime();
      launchOne(h.start, h.log, now === null ? 0 : now + RELAUNCH_LEAD_S);
    }, wait);
  };

  const launchOne = (
    s: StreamStart,
    log: (line: string) => void,
    relaunchAt?: number
  ) => {
    // To the millisecond, as the graph spells it, so the card feed (told
    // here) stamps its frames on exactly the canvas's clock.
    const startSeconds =
      relaunchAt === undefined ? undefined : Number(relaunchAt.toFixed(3));
    o.onLaunch(startSeconds ?? 0);
    const p = o.launch({
      tool: "ffmpeg",
      args: streamArgs({
        ports: s.ports,
        scene: scene ?? s.scene,
        micOffsetMs: s.micOffsetMs,
        micEq: s.micEq,
        url: `${s.ingest}/${s.streamKey}`,
        card: s.card,
        startSeconds,
      }),
      cwd: "/mnt/c",
    });
    const self: Running = {
      process: p,
      ending: false,
      framed: false,
      pushLost: false,
      gone: Promise.resolve(),
    };
    running = self;
    const current = () => running === self && !self.ending;
    const wentLive = () => {
      self.liveAt = Date.now();
      set({ kind: "live" });
    };

    // No new frame for too long: stalled. Stopped, then launched again.
    let stall: ReturnType<typeof setTimeout> | undefined;
    const watch = (ms: number) => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        if (!current()) return;
        console.error(
          `recorder: the Live Stream process stalled (no new frame for ${ms} ms); launching it again, the recording carries on`
        );
        self.gone = quit(self, STALLED_QUIT_TIMEOUT_MS);
      }, ms);
    };
    watch(stallMs * 4);

    // Its picture moving, not -progress coming, is what keeps it alive:
    // -progress comes on its own clock even while a feed that ended or
    // stalled holds every frame back (#2502).
    let lastFrame = 0;
    const read = readStreamHealth({
      pushing: () => !self.pushLost,
      onBlock: (frame) => {
        if (frame > lastFrame) watch(stallMs);
        lastFrame = Math.max(lastFrame, frame);
        if (!current() || frame === 0 || self.framed) return;
        self.framed = true;
        if (!self.pushLost) wentLive();
      },
      onHealth: (h) => {
        if (!current()) return;
        health = h;
        sendHealth();
      },
    });
    p.onStdout(read.stdout);
    p.onStderr(
      lineSplitter((line) => {
        read.stderrLine(line);
        log(line);
        if (!current()) return;
        if (PUSH_LOST.test(line) && !self.pushLost) {
          self.pushLost = true;
          // Lost once it was through; until then it is still connecting.
          if (status.kind === "live") reconnecting();
        } else if (PUSH_BACK.test(line) && self.pushLost) {
          self.pushLost = false;
          if (self.framed) wentLive();
        }
      })
    );

    void p.exited.then(async (code) => {
      clearTimeout(stall);
      if (running !== self) return;
      if (self.ending) return void (running = undefined);
      if (self.liveAt !== undefined && Date.now() - self.liveAt >= HEALTHY_MS)
        relaunches = 0;
      console.error(
        `recorder: the Live Stream process quit (exit ${code}); launching it again, the recording carries on`
      );
      reconnecting();
      const wait = Math.min(
        RELAUNCH_WAITS_MS.first * 2 ** relaunches,
        RELAUNCH_WAITS_MS.last
      );
      relaunches += 1;
      // A stalled one is gone from Windows too before its ports are reused.
      await self.gone;
      if (running !== self) return;
      running = undefined;
      relaunchLater(wait);
    });
    return self;
  };

  /**
   * Waits, up to `boundMs`, for the last Live Stream's process to have gone:
   * Go Live straight after End Stream is a restart, not a refusal. Only a
   * process still there past the bound refuses, so two never push at once.
   */
  const lastGone = async (boundMs: number): Promise<void> => {
    if (held) throw new Error("A Live Stream is already running.");
    if (quitting.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gone = await Promise.race([
      Promise.all(quitting).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), boundMs);
      }),
    ]);
    clearTimeout(timer);
    if (!gone) throw new Error(LAST_STREAM_STILL_QUITTING);
  };

  const start = async (s: StreamStart): Promise<void> => {
    if (running || held) throw new Error("A Live Stream is already running.");
    const log = stderrLog(redactStreamKey(s.streamKey));
    held = { start: s, log };
    reconnects = 0;
    feedOverflows = 0;
    lastOverflowAt = -Infinity;
    relaunches = 0;
    health = NO_HEALTH;
    set({ kind: "starting" });
    scene = s.scene;
    const self = launchOne(s, log);
    const p = self.process;
    const listening = new Promise<void>((resolve) => {
      p.onStderr((chunk) => {
        if (!BANNER.test(chunk)) return;
        if (running === self && status.kind === "starting")
          set({ kind: "connecting" });
        resolve();
      });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = o.listenBoundMs;
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
    held = undefined;
    clearTimeout(relaunchTimer);
    relaunchTimer = undefined;
    if (status.kind !== "idle" && status.kind !== "ended")
      set({ kind: "ended", reason });
    const r = running;
    if (!r || r.ending) return;
    r.ending = true;
    void quit(r, STREAM_QUIT_TIMEOUT_MS).finally(() => {
      if (running === r) running = undefined;
    });
  };

  /** The service's scene changed: the running stream shows it at once. */
  const switchScene = (next: Scene) => {
    scene = next;
    if (running && !running.ending)
      running.process.writeStdin(streamSceneCommand(next));
  };

  return {
    lastGone,
    feedOverflowed,
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
