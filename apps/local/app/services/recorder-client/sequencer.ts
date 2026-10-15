import type { RecordingSessionEvent } from "recorder-service/protocol";

/**
 * Puts the recorder service's events back in order, one Recording Session at
 * a time, so ingest sees each event exactly once and in `seq` order whatever
 * the socket delivered: a duplicate (a replay overlapping what was heard
 * live) is dropped, an event after a gap waits until the gap is filled, and
 * the gap is asked for again by `replay`.
 *
 * A speech's end, and a Take's start, come out with the time its speech
 * started at, so they are one stretch of speech however they arrived.
 *
 * An event handed out but then not saved is taken back by `forget`ting its
 * Recording Session: the sequencer starts it afresh, so a replay from the
 * start hands every event out again.
 *
 * After a reconnect, `heard` says where to replay a Recording Session from:
 * after its last event handed out, which ingest saves (or, failing, forgets).
 */

export type SequencedEvent =
  | Exclude<RecordingSessionEvent, { type: "speech-ended" | "take-started" }>
  | (Extract<
      RecordingSessionEvent,
      { type: "speech-ended" | "take-started" }
    > & {
      /** When the speech started, in mic file time. */
      startFileTime: number;
    });

export type SequencerResult = {
  /** Ready for ingest, in order. */
  ready: SequencedEvent[];
  /** Ask the recorder service for this Recording Session's events after `afterSeq`. */
  replay: { recordingSessionId: string; afterSeq: number } | null;
};

type SessionState = {
  /** The last `seq` handed out. */
  lastSeq: number;
  waiting: Map<number, RecordingSessionEvent>;
  speechStartedAt: number | null;
  /** The `afterSeq` last asked for, so one gap is asked for once. */
  askedAfter: number | null;
};

export const createRecorderEventSequencer = () => {
  const sessions = new Map<string, SessionState>();

  const accept = (event: RecordingSessionEvent): SequencerResult => {
    let session = sessions.get(event.recordingSessionId);
    if (!session) {
      session = {
        lastSeq: 0,
        waiting: new Map(),
        speechStartedAt: null,
        askedAfter: null,
      };
      sessions.set(event.recordingSessionId, session);
    }
    if (event.seq <= session.lastSeq) return { ready: [], replay: null };
    session.waiting.set(event.seq, event);

    const ready: SequencedEvent[] = [];
    for (
      let next = session.waiting.get(session.lastSeq + 1);
      next;
      next = session.waiting.get(session.lastSeq + 1)
    ) {
      session.waiting.delete(next.seq);
      session.lastSeq = next.seq;
      if (next.type === "speech-started") {
        session.speechStartedAt = next.fileTime;
        ready.push(next);
      } else if (next.type === "take-started") {
        // Every take-started is in a speech (speech-detector.ts).
        ready.push({
          ...next,
          startFileTime: session.speechStartedAt ?? next.fileTime,
        });
      } else if (next.type === "speech-ended") {
        // Every speech-ended follows its speech-started (speech-detector.ts).
        ready.push({
          ...next,
          startFileTime: session.speechStartedAt ?? next.fileTime,
        });
        session.speechStartedAt = null;
      } else {
        ready.push(next);
      }
    }

    const askNow =
      session.waiting.size > 0 && session.askedAfter !== session.lastSeq;
    if (askNow) session.askedAfter = session.lastSeq;
    return {
      ready,
      replay: askNow
        ? {
            recordingSessionId: event.recordingSessionId,
            afterSeq: session.lastSeq,
          }
        : null,
    };
  };

  /** Start a Recording Session afresh, as though none of it was heard. */
  const forget = (recordingSessionId: string) => {
    sessions.delete(recordingSessionId);
  };

  /** The last `seq` of a Recording Session handed out; 0 when none was. */
  const heard = (recordingSessionId: string) =>
    sessions.get(recordingSessionId)?.lastSeq ?? 0;

  return { accept, forget, heard };
};
