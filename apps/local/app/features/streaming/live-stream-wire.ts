import { Schema } from "effect";
import type { StreamStatus } from "recorder-service/stream-protocol";

/**
 * THE LIVE STREAM ON EVERY PAGE (ADR 0055): what the app server's recorder
 * client says of it, sent on the tab's one app-wide stream
 * (`/api/jobs/events`) as `live-stream-changed` when the stream opens and
 * each time it changes, so the Live indicator follows a Live Stream that
 * ends on its own. No socket of its own: a tab has six connections.
 */
export const LIVE_STREAM_CHANGED = "live-stream-changed";

const StreamStatusSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("idle") }),
  Schema.Struct({ kind: Schema.Literal("starting") }),
  Schema.Struct({ kind: Schema.Literal("connecting") }),
  Schema.Struct({ kind: Schema.Literal("live") }),
  Schema.Struct({ kind: Schema.Literal("reconnecting") }),
  Schema.Struct({ kind: Schema.Literal("ended"), reason: Schema.String })
) satisfies Schema.Schema<StreamStatus, StreamStatus>;

/** The Live Stream and the Video the recorder is open for; null while closed. */
export const LiveStreamHeard = Schema.NullOr(
  Schema.Struct({ videoId: Schema.String, status: StreamStatusSchema })
);
export type LiveStreamHeard = typeof LiveStreamHeard.Type;

/** One `live-stream-changed` event, as the app-wide stream sends it. */
export const liveStreamEvent = (heard: LiveStreamHeard) =>
  `event: ${LIVE_STREAM_CHANGED}\ndata: ${JSON.stringify(heard)}\n\n`;

let last: { heard: LiveStreamHeard } | undefined;
const listeners = new Set<(heard: LiveStreamHeard) => void>();

/** The tab's app-wide stream heard the Live Stream (`use-jobs.ts`). */
export const liveStreamHeard = (heard: LiveStreamHeard) => {
  last = { heard };
  for (const listener of listeners) listener(heard);
};

/** Hears the Live Stream: the last word at once, if any, then every change. */
export const subscribeToLiveStream = (
  listener: (heard: LiveStreamHeard) => void
) => {
  listeners.add(listener);
  if (last) listener(last.heard);
  return () => void listeners.delete(listener);
};
