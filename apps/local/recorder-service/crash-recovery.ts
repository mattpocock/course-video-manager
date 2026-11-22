import fs from "node:fs";
import { repairFiles } from "./footage-repair";
import { stopTagged } from "./camera";
import { CAPTURE_TAG, METER_TAG, PREVIEW_TAGS } from "./capture-args";
import type { Launcher } from "./launcher";
import { STREAM_TAG } from "./stream-args";
import type { RecordingSessionEvent } from "./protocol";
import { recorderTag } from "./recording-session";
import { endSpeech } from "./speech-detector";

/**
 * CRASH RECOVERY, at the recorder service's start-up. A Recording Session
 * whose event log has no stop was cut off: the service died (or the power
 * went) while it recorded, since nothing else is recording when the service
 * starts. For each one it stops any ffmpeg.exe still recording for it,
 * repairs its files (`footage-repair.ts`), ends a take still going at the
 * crash where the repaired mic file ends, and logs `recording-crashed`, so a
 * replay tells the app server all of it. A log that ends stopped or crashed
 * is left alone, so this runs once per crash.
 *
 * Every start, crash or not, first stops any preview ffmpeg.exe a service
 * that died left behind: a preview never exits by itself, and one left
 * holding the Cam Link would make every open fail as "in use". So is a Live
 * Stream process: one left behind would keep pushing to YouTube.
 */

export type IndexEntry = { recordingSessionId: string; eventLog: string };

/**
 * Every record in a JSONL file. A line that does not parse (the last one,
 * torn by a power cut mid-write) is skipped and logged, so one bad line never
 * hides the rest of the file, nor every other Recording Session.
 */
export const readJsonLines = <T>(file: string): T[] =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        console.error(`recorder: skipped an unreadable line in ${file}`);
        return [];
      }
    });

/** Appends one record, on a line of its own even after a torn last line. */
const appendJsonLine = (file: string, record: unknown) => {
  const text = fs.readFileSync(file, "utf8");
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(file, `${sep}${JSON.stringify(record)}\n`);
};

const ENDED: RecordingSessionEvent["type"][] = [
  "recording-stopped",
  "recording-crashed",
];

/** Returns the ids of the Recording Sessions it recovered. */
export const recoverCrashedSessions = async (o: {
  launch: Launcher;
  index: IndexEntry[];
}): Promise<string[]> => {
  const cutOff = o.index.flatMap((entry) => {
    try {
      if (!fs.existsSync(entry.eventLog)) return [];
      const events = readJsonLines<RecordingSessionEvent>(entry.eventLog);
      const started = events.find((e) => e.type === "recording-started");
      if (!started || started.type !== "recording-started") return [];
      if (events.some((e) => ENDED.includes(e.type))) return [];
      return [{ ...entry, events, files: started.files }];
    } catch (e) {
      console.error(
        `recorder: could not read Recording Session ${entry.recordingSessionId}`,
        e
      );
      return [];
    }
  });

  // A service that died leaves its ffmpeg.exe processes running on Windows:
  // the camera capture holding the Cam Link and the mic, previews, a level
  // meter holding the mic, a Live Stream still pushing to YouTube, recorders
  // holding their files. None can be asked to finish, so they are stopped,
  // and the files repaired like any other cut off.
  await stopTagged(o.launch, [
    PREVIEW_TAGS.camera,
    PREVIEW_TAGS.screen,
    CAPTURE_TAG,
    METER_TAG,
    STREAM_TAG,
    ...cutOff.map((s) => recorderTag(s.recordingSessionId)),
  ]);
  if (cutOff.length === 0) return [];

  const recovered: string[] = [];
  for (const session of cutOff) {
    try {
      const repaired = await repairFiles(o.launch, session.files);
      let seq = Math.max(...session.events.map((e) => e.seq));
      const append = (event: RecordingSessionEvent) =>
        appendJsonLine(session.eventLog, event);
      const lastSpeech = session.events.findLastIndex(
        (e) => e.type === "speech-started" || e.type === "speech-ended"
      );
      const cutOffSpeech = session.events[lastSpeech];
      if (
        cutOffSpeech?.type === "speech-started" &&
        repaired.mic.duration !== null
      ) {
        // Ended as the detector ends any speech: a Take's Clip only for
        // speech that is, or was already, a Take.
        const ended = endSpeech({
          startedAt: cutOffSpeech.fileTime,
          takeStarted: session.events
            .slice(lastSpeech)
            .some((e) => e.type === "take-started"),
          fileTime: repaired.mic.duration,
        });
        for (const event of ended)
          append({
            ...event,
            seq: (seq += 1),
            recordingSessionId: session.recordingSessionId,
          });
      }
      append({
        type: "recording-crashed",
        files: session.files,
        repairs: {
          camera: repaired.camera.repair,
          screen: repaired.screen.repair,
          mic: repaired.mic.repair,
        },
        seq: (seq += 1),
        recordingSessionId: session.recordingSessionId,
      });
      recovered.push(session.recordingSessionId);
    } catch (e) {
      // One Recording Session's drive gone must not stop the service; it is
      // tried again at the next start.
      console.error(
        `recorder: could not recover Recording Session ${session.recordingSessionId}`,
        e
      );
    }
  }
  return recovered;
};
