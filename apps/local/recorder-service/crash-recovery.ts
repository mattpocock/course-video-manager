import fs from "node:fs";
import { repairFiles } from "./footage-repair";
import { runToEnd, type Launcher } from "./launcher";
import type { RecordingSessionEvent } from "./protocol";
import { recorderTag } from "./recording-session";

/**
 * CRASH RECOVERY, at the recorder service's start-up. A Recording Session
 * whose event log has no stop was cut off: the service died (or the power
 * went) while it recorded, since nothing else is recording when the service
 * starts. For each one it stops any ffmpeg.exe still recording for it,
 * repairs its files (`footage-repair.ts`), ends a take still going at the
 * crash where the repaired mic file ends, and logs `recording-crashed`, so a
 * replay tells the app server all of it. A log that ends stopped or crashed
 * is left alone, so this runs once per crash.
 */

export type IndexEntry = { recordingSessionId: string; eventLog: string };

const readEvents = (eventLog: string) =>
  fs
    .readFileSync(eventLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordingSessionEvent);

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
    if (!fs.existsSync(entry.eventLog)) return [];
    const events = readEvents(entry.eventLog);
    const started = events.find((e) => e.type === "recording-started");
    if (!started || started.type !== "recording-started") return [];
    if (events.some((e) => ENDED.includes(e.type))) return [];
    return [{ ...entry, events, files: started.files }];
  });
  if (cutOff.length === 0) return [];

  // A service that died can leave its ffmpeg.exe processes running on
  // Windows, holding the files open. They cannot be asked to finish, so they
  // are stopped, and their files repaired like any other cut off.
  const stopped = await runToEnd(
    o.launch({
      tool: "powershell",
      script: "stop-recorders.ps1",
      args: [
        "-Tags",
        cutOff.map((s) => recorderTag(s.recordingSessionId)).join(","),
      ],
    })
  );
  if (stopped.code !== 0)
    console.error(`recorder: stop-recorders.ps1 failed: ${stopped.stderr}`);

  const recovered: string[] = [];
  for (const session of cutOff) {
    try {
      const repaired = await repairFiles(o.launch, session.files);
      let seq = Math.max(...session.events.map((e) => e.seq));
      const append = (event: RecordingSessionEvent) =>
        fs.appendFileSync(session.eventLog, `${JSON.stringify(event)}\n`);
      const lastSpeech = session.events.findLast(
        (e) => e.type === "speech-started" || e.type === "speech-ended"
      );
      if (
        lastSpeech?.type === "speech-started" &&
        repaired.mic.duration !== null
      ) {
        append({
          type: "speech-ended",
          fileTime: repaired.mic.duration,
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
