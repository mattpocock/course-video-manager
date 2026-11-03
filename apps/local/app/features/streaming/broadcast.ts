/**
 * A **Broadcast**: a YouTube live event on Matt's channel (upcoming or
 * active), picked before Go Live. The Live Stream is pushed to it, and its
 * live chat is the chat shown. As the YouTube Live service lists it.
 */
export type Broadcast = {
  /** YouTube's id for the Broadcast. */
  id: string;
  title: string;
  /** ISO time YouTube has it scheduled to start, if any. */
  scheduledStartTime: string | null;
  /** YouTube starts it on its own once the push arrives. */
  enableAutoStart: boolean;
  /** YouTube ends it on its own once the push stops. */
  enableAutoStop: boolean;
  liveChatId: string | null;
  /** The YouTube stream it is bound to, if any. */
  boundStreamId: string | null;
  /** How far behind live its viewers watch, as set in YouTube Studio; null: not said. */
  latencyPreference: LatencyPreference | null;
};

/** A Broadcast's latency setting (`contentDetails.latencyPreference`). */
export type LatencyPreference = "normal" | "low" | "ultraLow";

/**
 * END STREAM'S WAIT (#2660): how long End Stream keeps the Live Stream
 * pushing (and its Recording Session recording) before it stops the push and
 * completes the Broadcast, so viewers, who watch behind live by the
 * Broadcast's latency, see everything said before the press. YouTube does
 * not report the viewers' measured latency, so it is fixed by the setting,
 * at the top of what YouTube gives for each: Normal (or not said) 20 s, Low
 * 10 s, Ultra-low 5 s.
 */
export const END_STREAM_WAIT_MS: Record<LatencyPreference, number> = {
  normal: 20_000,
  low: 10_000,
  ultraLow: 5_000,
};

export const endStreamWaitMs = (broadcast: Broadcast): number =>
  END_STREAM_WAIT_MS[broadcast.latencyPreference ?? "normal"];

/**
 * Why Google needs (re)connecting before Broadcasts can be listed: no stored
 * grant, or one given before CVM asked for live-streaming access
 * (`youtube.force-ssl`).
 */
export type ReconnectReason = "not-connected" | "missing-live-access";

/** What `GET /api/streaming/broadcasts` answers. */
export type BroadcastListAnswer =
  | { status: "listed"; broadcasts: Broadcast[] }
  | { status: "needs-reconnect"; reason: ReconnectReason };

/**
 * Why Go Live will refuse this Broadcast, or `null`. CVM never starts a
 * Broadcast itself, and completes one only at End Stream, so one YouTube
 * won't auto-start would never go live, and one it won't auto-stop would
 * never end after a Live Stream that ended any other way.
 */
export const broadcastRefusal = (broadcast: Broadcast): string | null => {
  const missing = [
    !broadcast.enableAutoStart && "auto-start",
    !broadcast.enableAutoStop && "auto-stop",
  ].filter((m): m is string => m !== false);
  if (missing.length === 0) return null;
  return `Turn on ${missing.join(" and ")} for this Broadcast in YouTube Studio: CVM never starts a Broadcast itself, and ends one only at End Stream.`;
};
