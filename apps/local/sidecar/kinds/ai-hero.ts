import { Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  findAiHeroPost,
  postToAiHero,
} from "@/services/ai-hero-upload-service";
import { definePostingJobKind, type PostCheck } from "../job-kind";
import { reportPost } from "./post-events";
import { PostNotStartedError } from "./youtube";

export const aiHeroUrl = (slug: string) => `https://aihero.dev/${slug}`;

/**
 * **AI Hero post** (#4 in docs/plans/background-jobs-sidecar.md): the export
 * uploaded to AI Hero, a post created, filled and published — the same
 * `postToAiHero` the `post-ai-hero` route ran (its 5 tries per uploaded part
 * stay inside it). A POSTING kind (decision 5): one attempt, never
 * re-queued, and only the author's Retry runs it again.
 */
export const aiHeroJobKind = definePostingJobKind({
  params: JOB_PARAMS["ai-hero"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publish = yield* CoursePublishService;
      const filePath = yield* publish.resolveExportPath(params.videoId);
      if (!filePath) {
        return yield* new PostNotStartedError({
          message: "Video has not been exported",
        });
      }
      const reports = yield* reportPost(ctx);
      const result = yield* postToAiHero({
        filePath,
        title: params.title,
        body: params.body,
        description: params.description.trim(),
        slug: params.slug,
        visibility: params.visibility,
        onProgress: (percent) => reports.onProgress("uploading", percent),
      }).pipe(
        Effect.tap((r) =>
          Effect.sync(() =>
            reports.posted({ slug: r.slug, url: aiHeroUrl(r.slug) })
          )
        ),
        Effect.ensuring(reports.flush)
      );
      yield* Effect.logInfo("ai-hero: published", { slug: result.slug });
    }),
  checkPosted: (params) =>
    Effect.gen(function* () {
      if (!params.slug) {
        return {
          verdict: "unknown",
          detail:
            "It had no slug of its own, so AI Hero cannot be asked: check your AI Hero posts before retrying.",
          url: null,
        } satisfies PostCheck;
      }
      const found = yield* findAiHeroPost(params.slug);
      if (!found) {
        return {
          verdict: "not-posted",
          detail: `It did not go out: AI Hero has no post "${params.slug}".`,
          url: null,
        } satisfies PostCheck;
      }
      return {
        verdict: "posted",
        detail: `AI Hero has a post "${found.slug}"${found.state ? ` (${found.state})` : ""}: it went out, or got part of the way.`,
        url: aiHeroUrl(found.slug),
      } satisfies PostCheck;
    }),
});
