import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { Console, Effect, Either } from "effect";

/**
 * A **Transcription** of a batch of Clips, persisted WHOLE (CONTEXT.md,
 * "Transcription" and "Transcript Word").
 *
 * Whisper hands back two halves of one result — the spoken text and the
 * word-level timing behind it — and a Clip is only really transcribed when
 * BOTH have landed. This is the one place in the app that writes them, so it
 * is also the one place that can guarantee they are written together; the
 * `clips/transcribe` route is a thin adapter over it, which is what makes the
 * guarantee testable without a Whisper key or an ffmpeg binary.
 *
 * Split out of the route rather than left inline because the route's own
 * module cannot be imported by a test (it pulls in the live runtime layer).
 */
export const transcribeAndPersistClips = Effect.fn("transcribeAndPersistClips")(
  function* (clipIds: readonly string[]) {
    const clipOps = yield* ClipOperationsService;
    const videoProcessing = yield* VideoProcessingService;

    const clips = yield* clipOps.getClipsByIds(clipIds);

    /**
     * One Clip, transcribed and written.
     *
     * The words go in BEFORE the `text`/`transcribedAt` that claims the Clip
     * is transcribed, so a run that dies between the two writes leaves a Clip
     * that still asks to be transcribed rather than one that says it already
     * was and has no timing to show for it.
     */
    const transcribeOne = (clip: (typeof clips)[number]) =>
      Effect.gen(function* () {
        const [transcribed] = yield* videoProcessing.transcribeClips([
          {
            id: clip.id,
            inputVideo: clip.videoFilename,
            startTime: clip.sourceStartTime,
            duration: clip.sourceEndTime - clip.sourceStartTime,
          },
        ]);
        if (!transcribed) return null;

        // Whisper's word timing is CLIP-RELATIVE here already (the audio was
        // extracted for this clip's range), so it is stored as-is. Every
        // transcription replaces the clip's Transcript Words wholesale, so a
        // re-transcribe never leaves words from the previous take behind.
        yield* clipOps.replaceTranscriptWords(clip.id, transcribed.words);

        return yield* clipOps.updateClip(clip.id, {
          text: transcribed.segments.map((segment) => segment.text).join(" "),
          transcribedAt: new Date(),
        });
      });

    // Each Clip stands or falls ALONE. The Video-wide re-transcribe (#1571) is
    // how a Video's word timing gets backfilled, and a Video routinely holds a
    // Clip whose source file has moved or that is white noise with nothing to
    // hear — one of those must not cost every other Clip in the Video its
    // words, which is what a single all-or-nothing batch did.
    const outcomes = yield* Effect.forEach(
      clips,
      (clip) => Effect.either(transcribeOne(clip)),
      { concurrency: "unbounded" }
    );

    const failures = outcomes.filter(Either.isLeft);
    for (const failure of failures) {
      yield* Console.dir(failure.left, { depth: null });
    }

    // Nothing at all got through: that is not a partial result to report back,
    // it is a failed request, and the editor says so rather than quietly
    // leaving every Clip as it was.
    const firstFailure = failures[0];
    if (firstFailure && failures.length === outcomes.length) {
      return yield* Effect.fail(firstFailure.left);
    }

    // Every Clip that was asked about is answered for, because the editor
    // clears a Clip's "transcribing" spinner off this list. One that failed
    // comes back exactly as it was — still visibly untranscribed — rather than
    // being left out and spinning for the rest of the session.
    return outcomes.map((outcome, index) =>
      Either.isRight(outcome) && outcome.right !== null
        ? outcome.right
        : clips[index]!
    );
  }
);
