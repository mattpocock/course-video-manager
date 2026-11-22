import fs from "node:fs";
import path from "node:path";
import { readJsonLines, type IndexEntry } from "./crash-recovery";
import { RECENT_SESSIONS, type RecordingSessionEvent } from "./protocol";
import { Refusal } from "./refusal";

/**
 * THE RECORDING SESSION INDEX: every Recording Session the service has
 * started, oldest first, with where its `events.jsonl` is, in the service's
 * own state folder. Crash recovery, the greeting's recent sessions and a
 * client's replay all read it.
 */
export const createSessionIndex = (stateDir: string) => {
  const file = path.join(stateDir, "recording-sessions.jsonl");
  fs.mkdirSync(stateDir, { recursive: true });
  const read = (): IndexEntry[] =>
    fs.existsSync(file) ? readJsonLines<IndexEntry>(file) : [];
  return {
    read,
    /**
     * Adds a Recording Session that is already recording: a failed write
     * must not turn into a refusal that leaves it running unseen. It only
     * costs replay.
     */
    add: (entry: IndexEntry) => {
      try {
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
      } catch (e) {
        console.error("recorder: could not index the Recording Session", e);
      }
    },
    /** The latest few Recording Sessions' ids, for the greeting. */
    recent: () => {
      try {
        return read()
          .slice(-RECENT_SESSIONS)
          .map((e) => e.recordingSessionId);
      } catch (e) {
        console.error(
          "recorder: could not read the Recording Session index",
          e
        );
        return [];
      }
    },
    /** A Recording Session's logged events after `afterSeq`, and its last seq. */
    replay: (recordingSessionId: string, afterSeq: number) => {
      const eventLog = read().find(
        (e) => e.recordingSessionId === recordingSessionId
      )?.eventLog;
      if (!eventLog || !fs.existsSync(eventLog)) {
        throw new Refusal(
          `No event log for Recording Session ${recordingSessionId}.`
        );
      }
      let lastSeq = 0;
      const events: RecordingSessionEvent[] = [];
      for (const event of readJsonLines<RecordingSessionEvent>(eventLog)) {
        lastSeq = Math.max(lastSeq, event.seq);
        if (event.seq > afterSeq) events.push(event);
      }
      return { events, lastSeq };
    },
  };
};
