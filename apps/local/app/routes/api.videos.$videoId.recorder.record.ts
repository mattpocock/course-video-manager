import { Effect, Schema } from "effect";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { requireRecordableVideo } from "@/services/recorder-client/record-guard.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { requireFreshAVCalibration } from "@/services/av-calibration.server";
import { makeAction } from "@/services/route-action.server";

const startRecordingSchema = Schema.Struct({
  silenceLength: Schema.Literal("short", "long"),
});

/**
 * Record: the recorder service starts a Recording Session in a folder of its
 * own beside the old OBS recordings. Answers once it is recording; a refusal
 * is a 409 with the reason: the Video's Version is not the Draft, no AV
 * Calibration passed in the last 7 days (ADR 0038), or the recorder said no
 * (it checks the mic).
 */
export const action = makeAction({
  input: "json",
  errors: {
    RecorderCommandError: 409,
    AVCalibrationRequiredError: 409,
    VersionNotDraftError: 409,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request =
        yield* Schema.decodeUnknown(startRecordingSchema)(payload);
      const folder = recordingFolder();
      const videoId = params.videoId!;
      const db = yield* DrizzleService;
      const { format } = yield* requireRecordableVideo(db, videoId);
      yield* requireFreshAVCalibration(db, new Date());
      yield* recorderCommand(() =>
        recorderClient().startRecording(videoId, {
          ...request,
          folder,
          format,
        })
      );
      return { ok: true };
    }),
});
