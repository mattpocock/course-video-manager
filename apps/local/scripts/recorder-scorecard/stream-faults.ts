import type { RecorderMessage } from "../../recorder-service/protocol";
import { STREAM_TAG } from "../../recorder-service/stream-args";
import type { StreamStatus } from "../../recorder-service/stream-protocol";
import type { Received } from "./service-control";
import type { ProgressSample } from "./stream-sink";
import { hold, type Ctx } from "./takes";
import { killMarked } from "./windows";

/**
 * THE LIVE STREAM'S FAULTS, MID-TAKE (#2459): the sink (YouTube) drops and
 * comes back, then the stream ffmpeg.exe is killed. The stream must come
 * back on its own each time, for ever, and the take must not notice: its
 * framesLost are the streamed scenario's own metrics.
 *
 * - The sink drop is reconnected inside the stream process: its push's fifo
 *   retries until the sink listens again. No relaunch (its frames never
 *   count from 0 again).
 * - The kill is reconnected outside it: the stream side launches it again,
 *   which listens on the same ports for the take's feeds, and pushes to a
 *   sink started again.
 */

/** How long YouTube is gone before the sink listens again. */
const SINK_DOWN_MS = 10_000;

/** How long each reconnect may take: a few relaunch waits and fifo retries. */
const BACK_WITHIN_MS = 45_000;

/** The sinks the Live Stream has pushed to, in order: the current one is last. */
export type Sinks = {
  current: () => { frames: () => number; close: (ms: number) => Promise<void> };
  /** Stops the current sink: YouTube gone. */
  drop: () => Promise<void>;
  /** A new sink on the same address. */
  restore: () => void;
};

const streamOf = (m: RecorderMessage): StreamStatus | undefined =>
  m.type === "state" && m.state.kind !== "closed" ? m.state.stream : undefined;

/** Waits for the Live Stream's status to be `kind`, heard from `from` on; null if it never is. */
const statusFrom = (
  ctx: Ctx,
  kind: StreamStatus["kind"],
  from: number,
  timeoutMs: number
): Promise<Received | null> =>
  ctx.client
    .waitFor((m) => streamOf(m)?.kind === kind, {
      from,
      timeoutMs,
      what: `the Live Stream ${kind}`,
    })
    .catch(() => null);

/** Whether -progress counted from 0 again between `from` and `to`: a new stream process. */
export const relaunchedBetween = (
  samples: readonly ProgressSample[],
  from: number,
  to: number
) =>
  samples
    .filter((s) => s.at >= from && s.at <= to)
    .some((s, i, a) => i > 0 && s.frame < a[i - 1]!.frame);

export const streamFaults = async (
  ctx: Ctx,
  o: {
    /** When Go Live was pressed and how long the take is. */
    goAt: number;
    seconds: number;
    sinks: Sinks;
    samples: readonly ProgressSample[];
  }
) => {
  const until = (fraction: number) =>
    hold(
      ctx,
      Math.max(0, o.goAt + fraction * o.seconds * 1000 - performance.now())
    );
  const since = (at: number, r: Received | null) =>
    r ? Math.round(r.at - at) : null;

  // YouTube gone, then back: the push retries inside the one process.
  await until(0.3);
  ctx.log("streamed: the sink drops (YouTube gone)");
  const dropFrom = ctx.client.received.length;
  const dropAt = performance.now();
  await o.sinks.drop();
  const dropReconnecting = await statusFrom(
    ctx,
    "reconnecting",
    dropFrom,
    15_000
  );
  await hold(ctx, SINK_DOWN_MS);
  ctx.log("streamed: the sink is back");
  const restoreFrom = ctx.client.received.length;
  const restoreAt = performance.now();
  o.sinks.restore();
  const dropBack = await statusFrom(ctx, "live", restoreFrom, BACK_WITHIN_MS);
  const restoredSink = o.sinks.current();
  const relaunched = relaunchedBetween(
    o.samples,
    dropAt,
    dropBack?.at ?? performance.now()
  );

  // The stream process killed: launched again, onto a sink started again.
  await until(0.6);
  const sinkFramesBeforeKill = restoredSink.frames();
  ctx.log("streamed: the stream ffmpeg.exe is killed");
  const killFrom = ctx.client.received.length;
  const killAt = performance.now();
  const killed = await killMarked(ctx.marker, [STREAM_TAG]);
  const killReconnecting = await statusFrom(
    ctx,
    "reconnecting",
    killFrom,
    15_000
  );
  // The sink ends with the push it took.
  await restoredSink.close(5_000);
  o.sinks.restore();
  const killBack = await statusFrom(ctx, "live", killFrom, BACK_WITHIN_MS);
  const relaunchedSink = o.sinks.current();

  return {
    /** When the sink dropped, and when the push was live again after it: the stretch left out of the rate. */
    sinkDown: { from: dropAt, until: dropBack?.at ?? killAt },
    /** When the stream process was killed: its own picture is measured until here. */
    killAt,
    /** When the relaunched one went live: its picture is measured from here. */
    relaunchedLiveAt: killBack?.at ?? null,
    /** Once End Stream is pressed: the faults' metrics and details. */
    result: () => {
      const sinkDrop = {
        reconnectingAfterMs: since(dropAt, dropReconnecting),
        liveAgainAfterRestoreMs: since(restoreAt, dropBack),
        relaunched,
        restoredSinkFrames: sinkFramesBeforeKill,
      };
      const kill = {
        killed,
        reconnectingAfterMs: since(killAt, killReconnecting),
        liveAgainAfterMs: since(killAt, killBack),
        relaunchedSinkFrames: relaunchedSink.frames(),
      };
      return {
        backAfterSinkDrop:
          dropReconnecting !== null &&
          dropBack !== null &&
          !relaunched &&
          sinkDrop.restoredSinkFrames > 0,
        backAfterKill:
          killed > 0 &&
          killReconnecting !== null &&
          killBack !== null &&
          kill.relaunchedSinkFrames > 0,
        details: { sinkDrop, kill },
      };
    },
  };
};
