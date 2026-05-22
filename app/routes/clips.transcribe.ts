import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/clips.transcribe";
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";

const transcribeClipsSchema = Schema.Struct({
  clipIds: Schema.Array(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const videoProcessing = yield* VideoProcessingService;

    const { clipIds } = yield* Schema.decodeUnknown(transcribeClipsSchema)(
      json
    );

    const clips = yield* clipOps.getClipsByIds(clipIds);

    const transcribedClips = yield* videoProcessing.transcribeClips(
      clips.map((clip) => ({
        id: clip.id,
        inputVideo: clip.videoFilename,
        startTime: clip.sourceStartTime,
        duration: clip.sourceEndTime - clip.sourceStartTime,
      }))
    );

    const updatedClips = yield* Effect.forEach(
      transcribedClips,
      (transcribedClip) => {
        return clipOps.updateClip(transcribedClip.id, {
          text: transcribedClip.segments
            .map((segment) => segment.text)
            .join(" "),
          transcribedAt: new Date(),
        });
      }
    );

    return updatedClips;
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
