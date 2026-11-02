import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { existsSync } from "node:fs";
import { draftIdOption, optionalDraftId } from "../entity-id";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import type { ShortPart } from "@cvm/core/services/db-short-create.server";
import { detail, emitNdjson, notFound, parseError } from "@/cli/helpers";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";
import { readFootageTranscript } from "@/services/footage-cache";
import {
  sliceTranscriptText,
  sliceTranscriptWords,
} from "@/services/footage-chunking";
import { probeFootage } from "@/services/footage-probe";
import { footageOnDisk, footagePathToStore } from "./footage-on-disk";
import { CREATE_HELP } from "./short.help";

/**
 * `short create` (#2577): a Standalone, Short-format Video cut from ranges of
 * a Video, a Recording Session or a Footage file. Registered on
 * `shortCommand` in ./short.ts.
 *
 * The ranges are parsed and checked HERE, where a Footage transcript can be
 * read off disk; the API then writes the Short and all its Clips in one
 * transaction (`createShortFromRanges`), so a refusal leaves nothing behind.
 */

const refuse = (message: string) => parseError(message, "short");

const secs = (n: number) => `${Number(n.toFixed(3))}s`;

/** A trimmed or cut Clip must still be a Clip. */
const requireLength = (start: number, end: number, what: string) =>
  end - start < MINIMUM_CLIP_LENGTH_SECONDS
    ? refuse(
        `${what} would be ${secs(end - start)}, below the ` +
          `${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length`
      )
    : Effect.void;

const SECONDS = /^\d+(?:\.\d+)?$/;

/** `<s>-<e>`, both plain non-negative seconds, start before end. */
const parseSpan = (range: string) =>
  Effect.gen(function* () {
    const [start, end, ...rest] = range.split("-");
    if (
      rest.length > 0 ||
      !start ||
      !end ||
      !SECONDS.test(start) ||
      !SECONDS.test(end)
    ) {
      return yield* refuse(
        `--range '${range}' is not <s>-<e> (seconds, e.g. 12.5-40)`
      );
    }
    const span = { start: Number(start), end: Number(end) };
    if (span.start >= span.end) {
      return yield* refuse(
        `--range '${range}' is empty or reversed: its start must be before its end`
      );
    }
    return span;
  });

/** `<clipId>[+<s>]` — one end of a Video range. */
const parseEnd = (end: string, range: string) =>
  Effect.gen(function* () {
    const [clipId, offset, ...rest] = end.split("+");
    if (
      !clipId ||
      rest.length > 0 ||
      (offset !== undefined && !SECONDS.test(offset))
    ) {
      return yield* refuse(
        `--range '${range}' is not <clipId>[+<s>]..<clipId>[+<e>]`
      );
    }
    return {
      clipId,
      offset: offset === undefined ? undefined : Number(offset),
    };
  });

/**
 * One Video range, as a copy Part per Clip it covers, the first and last
 * trimmed to the seconds given.
 */
const videoRangeParts = (videoId: string, range: string) =>
  Effect.gen(function* () {
    const ends = range.split("..");
    if (ends.length !== 2) {
      return yield* refuse(
        `--range '${range}' is not <clipId>[+<s>]..<clipId>[+<e>]`
      );
    }
    const from = yield* parseEnd(ends[0]!, range);
    const to = yield* parseEnd(ends[1]!, range);

    const clipOps = yield* ClipOperationsService;
    const rows = yield* clipOps.getClipsByIds([from.clipId, to.clipId]);
    for (const id of [from.clipId, to.clipId]) {
      const row = rows.find((r) => r.id === id);
      if (!row) return yield* refuse(`no Clip ${id} (in --range '${range}')`);
      if (row.videoId !== videoId) {
        return yield* refuse(
          `Clip ${id} is on Video ${row.videoId}, not on --video ${videoId}`
        );
      }
      if (row.archived) {
        return yield* refuse(
          `Clip ${id} is archived ('cvm clip restore ${id}' first)`
        );
      }
    }

    const videoOps = yield* VideoOperationsService;
    const { clips } = yield* videoOps.getVideoWithClipsById(videoId);
    const first = clips.findIndex((c) => c.id === from.clipId);
    const last = clips.findIndex((c) => c.id === to.clipId);
    if (first > last) {
      return yield* refuse(
        `--range '${range}' is reversed: Clip ${to.clipId} comes before Clip ${from.clipId}`
      );
    }

    const firstClip = clips[first]!;
    const lastClip = clips[last]!;
    const firstLength = firstClip.sourceEndTime - firstClip.sourceStartTime;
    const lastLength = lastClip.sourceEndTime - lastClip.sourceStartTime;
    const s = from.offset ?? 0;
    const e = to.offset ?? lastLength;
    if (s >= firstLength) {
      return yield* refuse(
        `--range '${range}' starts ${secs(s)} into Clip ${from.clipId}, ` +
          `which is only ${secs(firstLength)} long`
      );
    }
    if (e > lastLength) {
      return yield* refuse(
        `--range '${range}' ends ${secs(e)} into Clip ${to.clipId}, ` +
          `which is only ${secs(lastLength)} long`
      );
    }
    if (first === last && s >= e) {
      return yield* refuse(
        `--range '${range}' is empty or reversed: +${s} is not before +${e}`
      );
    }

    const parts: ShortPart[] = clips.slice(first, last + 1).map((clip, i) => ({
      kind: "copy",
      clipId: clip.id,
      sourceStartTime: clip.sourceStartTime + (i === 0 ? s : 0),
      sourceEndTime:
        first + i === last ? clip.sourceStartTime + e : clip.sourceEndTime,
    }));
    for (const part of [parts[0]!, parts[parts.length - 1]!]) {
      yield* requireLength(
        part.sourceStartTime,
        part.sourceEndTime,
        `the trimmed copy of Clip ${part.kind === "copy" ? part.clipId : ""}`
      );
    }
    return parts;
  });

/**
 * One cut of a Footage file: a new Clip, its text and words sliced from the
 * file's cached transcript, as `clip add --source` does.
 */
const footageCut = (
  footage: string,
  range: string,
  recordingSessionId: string | null
) =>
  Effect.gen(function* () {
    const { start, end } = yield* parseSpan(range);
    yield* requireLength(start, end, `--range '${range}'`);
    const onDisk = footageOnDisk(footage);
    if (!existsSync(onDisk)) {
      return yield* refuse(`no such Footage file: ${footage}`);
    }
    const probe = yield* probeFootage(onDisk).pipe(
      Effect.catchTag("FootageUnreadableError", (e) =>
        refuse(`ffprobe can't read the Footage ${footage} (${e.message})`)
      )
    );
    if (end > probe.durationSeconds) {
      return yield* refuse(
        `--range '${range}' ends past the end of ${footage} ` +
          `(${secs(probe.durationSeconds)} long)`
      );
    }
    const transcript = yield* readFootageTranscript(onDisk);
    if (transcript === null) {
      return yield* refuse(
        `no fresh cached transcript for ${footage} — run ` +
          `'cvm footage transcribe ${footage}' first`
      );
    }
    return {
      kind: "cut",
      recordingSessionId,
      videoFilename: footagePathToStore(footage, onDisk),
      sourceStartTime: start,
      sourceEndTime: end,
      text: sliceTranscriptText(transcript, start, end),
      transcriptWords: sliceTranscriptWords(transcript, start, end),
    } satisfies ShortPart;
  });

const nameOpt = Options.text("name").pipe(
  Options.withDescription("The new Short's name (required).")
);

const videoOpt = draftIdOption("video", "video").pipe(
  Options.withDescription(
    "Cut from this Video: each --range is <clipId>[+<s>]..<clipId>[+<e>]."
  ),
  Options.optional
);

const sessionOpt = Options.text("recording-session").pipe(
  Options.withDescription(
    "Cut from this Recording Session: each --range is <s>-<e> on its clock."
  ),
  Options.optional
);

const footageOpt = Options.text("footage").pipe(
  Options.withDescription(
    "Cut from this Footage file (root-relative or absolute): each --range is <s>-<e> in file seconds."
  ),
  Options.optional
);

const rangeOpt = Options.text("range").pipe(
  Options.withDescription(
    "A range of the source (repeatable; joined in the order given)."
  ),
  Options.atLeast(1)
);

export const createCmd = Command.make(
  "create",
  {
    name: nameOpt,
    video: videoOpt,
    recordingSession: sessionOpt,
    footage: footageOpt,
    range: rangeOpt,
  },
  ({ name, video: videoRef, recordingSession, footage, range }) =>
    Effect.gen(function* () {
      const videoId = yield* optionalDraftId(videoRef);
      const sessionId = Option.getOrUndefined(recordingSession);
      const footagePath = Option.getOrUndefined(footage);
      if (name.trim() === "") return yield* refuse("--name must not be empty");
      const given = [videoId, sessionId, footagePath].filter(
        (v) => v !== undefined
      );
      if (given.length !== 1) {
        return yield* refuse(
          "give exactly one source: --video, --recording-session or --footage"
        );
      }

      const videoOps = yield* VideoOperationsService;
      let parts: ShortPart[];
      if (videoId !== undefined) {
        yield* videoOps
          .getVideoWithClipsById(videoId)
          .pipe(
            Effect.catchTag("NotFoundError", () => notFound("video", videoId))
          );
        parts = (yield* Effect.forEach(range, (r) =>
          videoRangeParts(videoId, r)
        )).flat();
      } else if (sessionId !== undefined) {
        const session = yield* videoOps.getRecordingSessionForCut(sessionId);
        if (session === null) {
          return yield* refuse(`no Recording Session ${sessionId}`);
        }
        parts = yield* Effect.forEach(range, (r) =>
          footageCut(session.micFilePath, r, session.id)
        );
      } else {
        parts = yield* Effect.forEach(range, (r) =>
          footageCut(footagePath!, r, null)
        );
      }

      const short = yield* videoOps.createShortFromRanges({ name, parts });
      yield* emitNdjson([short]);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));
