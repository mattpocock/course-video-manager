import type { LastPassedCalibration } from "@/av-calibration-constants";
import type { AskEditor, IngestResult } from "./ingest.server";
import type { RecorderLiveStream } from "./live-stream-commands";
import type { RecorderServiceLauncher } from "./service-on-demand";
import type { SequencedEvent } from "./sequencer";

/** What the app server's recorder client (`client.server.ts`) is made with. */
export type RecorderClientOptions = {
  url: string;
  /** Saves one event; the client runs one at a time. */
  ingest: (
    event: SequencedEvent,
    askEditor: AskEditor
  ) => Promise<IngestResult>;
  /** How long a save waits for an editor to say where (`placeTake`). */
  placeTimeoutMs: number;
  /**
   * The Recording Sessions the database still has as recording, and those of
   * `candidates` it has no row for. Each is replayed whenever the recorder
   * service greets the client, so a start, stop or crash it missed (the app
   * server was down) is caught up on.
   */
  unfinishedRecordingSessions: (candidates: string[]) => Promise<string[]>;
  /** How long to wait before reconnecting to a recorder service that went away. */
  reconnectMs: number;
  /** How long a command may take to be carried out. */
  commandTimeoutMs: number;
  /** How long the recorder stays open after its last editor goes (a reload). */
  closeGraceMs: number;
  /** The pause before a Recording Session with an unsaved event is asked for again. */
  retryMs: number;
  /** The folder (WSL path) a Stream Deck Record's Recording Session goes in. */
  folder: string;
  /** What a Record goes by (ADR 0038): `lastPassedCalibration`. */
  calibration: () => Promise<LastPassedCalibration | null>;
  /** `whisper-warmth.ts` */
  keepWhisperWarm?: (ms: number) => void;
  /** Starts the service on demand. Absent: it is someone else's (a test's, or none). */
  launcher?: RecorderServiceLauncher;
  /** How long it stays up unneeded: `RECORDER_IDLE_MS`. */
  idleMs?: number;
  /**
   * The Live Stream, each time what the recorder says of it changes (the
   * Live indicator on every page, ADR 0055): `liveStream()`'s answer.
   */
  onLiveStreamChanged: (liveStream: RecorderLiveStream | null) => void;
  /**
   * A streamed Recording Session ended, whichever way (End Stream, the
   * camera lost, a process quitting): its Broadcast chat stops.
   */
  onStreamedSessionEnded: () => void;
};
