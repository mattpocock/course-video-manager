import { Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { bufferPostProgram } from "@/services/buffer-posting-orchestration.server";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { definePostingJobKind, type PostCheck } from "../job-kind";
import { reportPost } from "./post-events";
import { PostNotStartedError } from "./youtube";

/**
 * **Buffer post** (#2 in docs/plans/background-jobs-sidecar.md): the vertical
 * Short, uploaded to S3 and handed to Buffer — the same `bufferPostProgram`
 * the `post-social` route ran. A POSTING kind (decision 5): one attempt,
 * never re-queued, and only the author's Retry runs it again. A dead key
 * (`BufferAuthError`) fails it before anything is uploaded, and its row offers
 * no Retry: fix the key, then post again.
 */
export const bufferJobKind = definePostingJobKind({
  params: JOB_PARAMS["buffer"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const reports = yield* reportPost(ctx);
      // The program reports as it did to its stream; a stream `error` that
      // was not a failure (no exported file) is the Job failing here.
      let notStarted: string | null = null;
      // A Posting Queue post's caption is the Short's title, read now, and
      // only while the Short is still to be posted on this channel.
      const caption =
        "postingQueueEntryId" in params
          ? yield* Effect.flatMap(PostingQueueSidecarService, (queue) =>
              queue.assertStillToPost(params, "buffer").pipe(
                Effect.zipRight(queue.shortToPost(params)),
                Effect.map((short) => short.title)
              )
            )
          : params.caption;
      yield* bufferPostProgram({
        videoId: params.videoId,
        caption,
        sendEvent: (event, data) => {
          const d = (data ?? {}) as { percentage?: number; message?: string };
          if (event === "uploading-blob") {
            reports.onProgress("uploading-blob", d.percentage ?? 0);
          } else if (event === "creating-post") {
            reports.onStage("creating-post");
          } else if (event === "complete") {
            reports.posted({});
          } else if (event === "error") {
            notStarted = d.message ?? "Buffer post could not start";
          }
        },
      }).pipe(Effect.ensuring(reports.flush));
      if (notStarted !== null) {
        return yield* new PostNotStartedError({ message: notStarted });
      }
      yield* Effect.logInfo("buffer: submitted");
    }),
  /**
   * Buffer is asked nothing: its post id comes back only from `createPost`,
   * and the `video_post` row this run wrote says how far it got.
   */
  checkPosted: (params, post) =>
    Effect.gen(function* () {
      const videoPosts = yield* VideoPostOperationsService;
      const since = post.startedAt ? post.startedAt.getTime() - 1_000 : 0;
      const rows = (yield* videoPosts.listByVideoId(params.videoId)).filter(
        (row) => row.platform === "buffer" && row.createdAt.getTime() >= since
      );
      const last = rows.at(-1);
      if (!last) {
        return {
          verdict: "not-posted",
          detail:
            "It did not reach Buffer: it was cut off before the video was handed over.",
          url: null,
        } satisfies PostCheck;
      }
      if (last.remoteId) {
        return {
          verdict: "posted",
          detail: `It went out: Buffer accepted it as post ${last.remoteId}.`,
          url: "https://publish.buffer.com",
        } satisfies PostCheck;
      }
      return {
        verdict: "unknown",
        detail:
          "Buffer may have it: it was cut off while uploading or creating the post. Check publish.buffer.com before retrying.",
        url: "https://publish.buffer.com",
      } satisfies PostCheck;
    }),
});
