import type { LostFrameSpan } from "recorder-service/protocol";
import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * FRAMES LOST IN A CLIP (#2227). The recorder service counts every lost
 * camera and screen frame and says where in the take each fell
 * (`lostFrameSpans`, picture time). Only a loss inside a Clip is a freeze
 * Matt keeps, so only that raises the alert: lost frames in the silence
 * between Clips, or before the first, never do.
 *
 * A Clip's span comes from the recorder: open-ended from its speech's start
 * at `take-started`, then the bounds its Clip is cut to at `speech-ended`.
 * A loss can be told before its Take is known, so the alert is a selector
 * over both lists, worked out again whenever either changes, up to and after
 * `recording-stopped` (which carries every span, told or not). Both lists
 * belong to the Recording Session placed, and start empty with the next.
 */

/** A Take of the Recording Session placed, in picture time. */
export type TakeSpan = {
  takeId: string;
  startTime: number;
  /** Null until its speech ends: the Clip still being recorded. */
  endTime: number | null;
};

const isOurs = (
  before: cvmRecorderReducer.State,
  after: cvmRecorderReducer.State,
  id: string
) =>
  id === after.recordingSessionId ||
  id === before.placing ||
  id === after.placing;

const closeLatestTake = (
  takes: readonly TakeSpan[],
  recordingSessionId: string,
  clip: { startTime: number; endTime: number }
): readonly TakeSpan[] => {
  const open = takes.findLastIndex((t) => t.endTime === null);
  // Joined mid-take, its take-started was never heard.
  if (open === -1)
    return [
      ...takes,
      {
        takeId: `${recordingSessionId}@${clip.startTime}`,
        startTime: clip.startTime,
        endTime: clip.endTime,
      },
    ];
  return takes.map((t, i) =>
    i === open ? { ...t, startTime: clip.startTime, endTime: clip.endTime } : t
  );
};

/** The frames-lost half of a message, given the state before and after it. */
export const trackFramesLost = (
  before: cvmRecorderReducer.State,
  after: cvmRecorderReducer.State,
  message: CvmRecorderMessage
): cvmRecorderReducer.State => {
  const next =
    after.placing !== null && after.placing !== before.placing
      ? { ...after, lostFrameSpans: [], takeSpans: [] }
      : after;
  if (
    !("recordingSessionId" in message) ||
    message.type === "recorder-status" ||
    !isOurs(before, after, message.recordingSessionId)
  )
    return next;
  switch (message.type) {
    case "take-started":
      if (next.takeSpans.some((t) => t.takeId === message.takeId)) return next;
      return {
        ...next,
        takeSpans: [
          ...next.takeSpans,
          {
            takeId: message.takeId,
            startTime: message.startTime,
            endTime: null,
          },
        ],
      };
    case "speech-ended":
      if (!message.clip) return next;
      return {
        ...next,
        takeSpans: closeLatestTake(
          next.takeSpans,
          message.recordingSessionId,
          message.clip
        ),
      };
    case "frames-lost":
      // Every span so far, so a late or repeated one is no harm.
      return { ...next, lostFrameSpans: message.lostFrameSpans };
    case "recording-stopped":
      // A crash counted nothing more: what was heard live stands.
      return message.lostFrameSpans
        ? { ...next, lostFrameSpans: message.lostFrameSpans }
        : next;
    case "recording-started":
    case "warmed-up":
    case "speech-started":
    case "clips-saved":
    case "camera-lost":
      return next;
  }
};

const overlaps = (lost: LostFrameSpan, take: TakeSpan) =>
  lost.from <= (take.endTime ?? Infinity) && lost.to >= take.startTime;

const frames = (count: number, picture: string) =>
  `${count} ${picture} ${count === 1 ? "frame" : "frames"}`;

const list = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/** Each Clip hit: its place in the recording (1-based) and what it lost. */
export const clipsHitByLostFrames = (state: cvmRecorderReducer.State) =>
  state.takeSpans.flatMap((take, i) => {
    const lost = state.lostFrameSpans.filter((l) => overlaps(l, take));
    if (lost.length === 0) return [];
    const sum = (picture: LostFrameSpan["picture"]) =>
      lost
        .filter((l) => l.picture === picture)
        .reduce((n, l) => n + l.frames, 0);
    return [
      {
        number: i + 1,
        open: take.endTime === null,
        camera: sum("camera"),
        screen: sum("screen"),
      },
    ];
  });

/**
 * The alert's words (`framesLostAlert`), naming the Clips hit by their place
 * in the recording; null while no Clip has lost a frame.
 */
export const describeFramesLostInClips = (
  state: cvmRecorderReducer.State,
  recording: boolean
): string | null => {
  const hits = clipsHitByLostFrames(state);
  if (hits.length === 0) return null;
  const numbered = hits.filter((h) => !(h.open && recording));
  const beingRecorded = hits.length > numbered.length;
  const recordingName = recording ? "this recording" : "the last recording";
  const where = list([
    ...(numbered.length > 0
      ? [
          `${numbered.length === 1 ? "Clip" : "Clips"} ${list(numbered.map((h) => String(h.number)))} of ${recordingName}`,
        ]
      : []),
    ...(beingRecorded ? ["the Clip being recorded"] : []),
  ]);
  const camera = hits.reduce((n, h) => n + h.camera, 0);
  const screen = hits.reduce((n, h) => n + h.screen, 0);
  const what = list([
    ...(camera > 0 ? [frames(camera, "camera")] : []),
    ...(screen > 0 ? [frames(screen, "screen")] : []),
  ]);
  return `Frames lost in ${where}: ${what}. ${hits.length === 1 ? "It has" : "Each has"} a freeze in it.`;
};
