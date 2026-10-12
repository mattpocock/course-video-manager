import { clipFfmpegInput, clipSource } from "@/packages/clip-source";
import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import type { TranscribedClip } from "@/features/video-editor/transcribe-clips-response";

/**
 * **Clip transcription** (#12 in docs/plans/background-jobs-sidecar.md): the
 * named Clips go `transcribing`, then each is transcribed through Whisper on
 * its own and stored — its text, its Transcript Words, `done` — or marked
 * `failed`. One Clip that fails never fails the rest, and never fails the
 * whole run.
 *
 * Run by the `transcribe-clips` Job kind (`sidecar/kinds/transcribe-clips.ts`),
 * which the video editor enqueues. `onClipSettled` hears each Clip as it
 * lands, in the order they land.
 */
export const transcribeAndStoreClips = Effect.fn("transcribeAndStoreClips")(
  function* (
    clipIds: ReadonlyArray<string>,
    opts: {
      onClipSettled?: (clip: TranscribedClip) => Effect.Effect<void>;
    } = {}
  ) {
    const clipOps = yield* ClipOperationsService;
    const whisper = yield* WhisperTranscriptionService;
    const onClipSettled = opts.onClipSettled ?? (() => Effect.void);

    // With each Clip's Recording Session, so a new-recorder Clip is heard from
    // its mic file at mic time (start − offset), as playback and export do.
    const clips = yield* clipOps.getClipsWithRecordingSessionByIds([
      ...clipIds,
    ]);

    yield* clipOps.setTranscriptionStatus(
      clips.map((clip) => clip.id),
      "transcribing"
    );

    // Each Clip is transcribed on its own, so one that fails is marked
    // `failed` and the rest still land, rather than one bad Clip failing the
    // whole batch and leaving every Clip in it "transcribing".
    return yield* Effect.forEach(
      clips,
      (clip) =>
        Effect.gen(function* () {
          const [transcribedClip] = yield* whisper.transcribeClips([
            { id: clip.id, ...clipFfmpegInput(clipSource(clip)) },
          ]);

          const updated = yield* clipOps.updateClip(clip.id, {
            text: (transcribedClip?.segments ?? [])
              .map((segment) => segment.text)
              .join(" "),
            transcribedAt: new Date(),
            transcriptionStatus: "done",
          });

          // Whisper's word timing is CLIP-RELATIVE here already (the audio
          // was extracted for this clip's range), so it is stored as-is.
          // Every transcription replaces the clip's Transcript Words
          // wholesale, so a re-transcribe never leaves words from the
          // previous take behind.
          const words = yield* clipOps.replaceTranscriptWords(
            clip.id,
            transcribedClip?.words ?? []
          );

          // The editor's "missing word timing" warning needs to know whether
          // this Transcription gave the Clip any words (see
          // transcript-word-status.ts), without a second round trip.
          return {
            id: updated.id,
            transcriptionStatus: "done",
            text: updated.text,
            hasTranscriptWords: words.length > 0,
          } satisfies TranscribedClip as TranscribedClip;
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(`Transcription failed for clip ${clip.id}`, error)
          ),
          Effect.catchAll(() =>
            clipOps.setTranscriptionStatus([clip.id], "failed").pipe(
              Effect.as({
                id: clip.id,
                transcriptionStatus: "failed",
              } satisfies TranscribedClip as TranscribedClip)
            )
          ),
          Effect.tap(onClipSettled)
        ),
      { concurrency: "unbounded" }
    );
  }
);
