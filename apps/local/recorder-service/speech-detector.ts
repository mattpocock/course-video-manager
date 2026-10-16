import {
  isLongEnoughForClip,
  MINIMUM_CLIP_LENGTH_SECONDS,
  takeStartsAt,
} from "../app/silence-detection-constants";

/**
 * Turns the camera+mic process's silencedetect lines into speech starting and
 * ending, in mic file time. The one silence detector (#1993, Q3): speech is
 * what lies between a silence's end and the next silence's start, the rule
 * `parseSpeechFromFFmpeg` applies to OBS recordings.
 *
 * Every Recording Session opens in silence (the mic's first 1.5 s are padded
 * with it, capture-args.ts), so its first speech is a `silence_end`.
 *
 * The first silence, heard before any speech, is `warmed-up`: the take is
 * ready for speech: the end of "warming up" the editor and the teleprompter
 * show (speech-detector-reducer.ts).
 *
 * TAKES. This is also the one place that decides a speech is long enough to
 * be a Clip, by the rule the app server cuts Clips with
 * (`isLongEnoughForClip`): `take-started` says so, and the editor shows its
 * Optimistic Clip on it alone. It comes once the file has run to
 * `takeStartsAt` (the minimum Clip length and a Silence Length past the
 * speech's start) with no silence reported, or, for speech that ends before
 * the file got there, just before its `speech-ended` when that speech is
 * long enough. So every `take-started` is followed by a `speech-ended` that
 * makes a Clip, and every `speech-ended` that makes a Clip by one.
 */
export type Speech = {
  type: "warmed-up" | "speech-started" | "take-started" | "speech-ended";
  fileTime: number;
};

const LINE = /\[silencedetect @[^\]]*\].*?silence_(start|end):\s*(-?[\d.]+)/;

/**
 * The end of a speech that started at `startedAt`: its `take-started`, if it
 * is a Take not yet started, then its `speech-ended`. A Take's end is never
 * under the minimum Clip length: if its silence is reported a hair earlier
 * than the file time that started it (stderr and the progress lines are two
 * pipes), the Take still makes the Clip the editor was shown.
 */
export const endSpeech = (o: {
  startedAt: number;
  takeStarted: boolean;
  fileTime: number;
}): Speech[] => {
  const isTake = o.takeStarted || isLongEnoughForClip(o.startedAt, o.fileTime);
  if (!isTake) return [{ type: "speech-ended", fileTime: o.fileTime }];
  const ended: Speech = {
    type: "speech-ended",
    fileTime: Math.max(o.fileTime, o.startedAt + MINIMUM_CLIP_LENGTH_SECONDS),
  };
  return o.takeStarted
    ? [ended]
    : [{ type: "take-started", fileTime: o.fileTime }, ended];
};

/** `minSilenceSeconds`: the Recording Session's Silence Length. */
export const createSpeechDetector = (minSilenceSeconds: number) => {
  /** When the speech going now started; null in silence. */
  let startedAt: number | null = null;
  let takeStarted = false;
  let stopping = false;
  let warm = false;
  const end = (fileTime: number): Speech[] => {
    if (startedAt === null) return [];
    const events = endSpeech({ startedAt, takeStarted, fileTime });
    startedAt = null;
    takeStarted = false;
    return events;
  };
  return {
    /**
     * From here on no new speech starts: ffmpeg ends a file that closes in
     * silence with one last `silence_end`, which is not speech.
     */
    stopRequested() {
      stopping = true;
    },
    /** The speech changes one stderr line reports, if any. */
    line(line: string): Speech[] {
      const m = line.match(LINE);
      if (!m) return [];
      // A file that opens in silence reports silence_start: -0.0001.
      const fileTime = Math.max(0, Number(m[2]));
      const speaking = startedAt !== null;
      if (m[1] === "start" && !speaking && !warm && !stopping) {
        warm = true;
        return [{ type: "warmed-up", fileTime }];
      }
      if (m[1] === "end" && !speaking && !stopping) {
        warm = true;
        startedAt = fileTime;
        takeStarted = false;
        return [{ type: "speech-started", fileTime }];
      }
      if (m[1] === "start" && speaking) return end(fileTime);
      return [];
    },
    /**
     * The file has been written up to `fileTime` (the writer's progress):
     * the speech going now becomes a Take once it is provably long enough.
     */
    progress(fileTime: number): Speech | undefined {
      if (startedAt === null || takeStarted) return undefined;
      if (fileTime < takeStartsAt(startedAt, minSilenceSeconds))
        return undefined;
      takeStarted = true;
      return { type: "take-started", fileTime };
    },
    /**
     * Speech still going when the recording stopped ends where the file
     * does, so the last take is not lost for want of a silence after it.
     */
    stop(fileTime: number): Speech[] {
      return end(fileTime);
    },
  };
};
