import { Effect, Schema } from "effect";
import { InsertionPointSchema } from "@/services/clip-service.schemas";
import { recorderCommand } from "@/services/recorder-client/client.server";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { requireRecordableVideo } from "@/services/recorder-client/record-guard.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";

const startRecordingSchema = Schema.Struct({
  silenceLength: Schema.Literal("short", "long"),
  insertionPoint: InsertionPointSchema,
});

/**
 * Record, on a New recorder Video: the recorder service starts a Recording
 * Session in a folder of its own beside the OBS recordings. Answers once it
 * is recording; a refusal is a 409 with the reason: the Video records with
 * OBS, its Version is not the Draft, or the recorder said no.
 */
export const action = makeAction({
  input: "json",
  errors: {
    RecorderCommandError: 409,
    RecordOnOBSVideoError: 409,
    VersionNotDraftError: 409,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request =
        yield* Schema.decodeUnknown(startRecordingSchema)(payload);
      const folder = recordingFolder();
      const videoId = params.videoId!;
      yield* requireRecordableVideo(yield* DrizzleService, videoId);
      yield* recorderCommand(() =>
        recorderClient().startRecording(videoId, { ...request, folder })
      );
      return { ok: true };
    }),
});
