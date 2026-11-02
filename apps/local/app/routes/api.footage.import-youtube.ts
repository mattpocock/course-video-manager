import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { startYoutubeImport } from "@/services/youtube-footage-import.server";

const importYoutubeSchema = Schema.Struct({ url: Schema.String });

/**
 * The Imported Footage page's URL box (#2545): start the same import as
 * `cvm footage import <youtube-url>`. Answers `{ videoId, jobId, path }`:
 * `jobId` is the `import-youtube-footage` Job whose progress the page shows,
 * null when that video is already imported (then `path` is its file).
 */
export const action = makeAction({
  input: "formData",
  errors: {
    NotYoutubeVideoUrlError: 400,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { url } = yield* Schema.decodeUnknown(importYoutubeSchema)(payload);
      const started = yield* startYoutubeImport(url);
      return {
        videoId: started.videoId,
        jobId: started.jobId,
        path: started.path,
      };
    }),
});
