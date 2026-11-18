import { Command, Options } from "@effect/cli";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { ConfigProvider, Effect, Logger, LogLevel } from "effect";
import { statSync } from "node:fs";
import {
  JobOperationsService,
  POSTED_EVENT,
} from "@cvm/core/services/db-job-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeCoursePublishReads } from "@/services/course-publish-reads";
import { loadUploadableThumbnail } from "@/services/youtube-thumbnail.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { loadRepoEnv } from "@/services/repo-env";
import { findYouTubeMetadataProblem } from "@/lib/youtube-metadata";
import {
  NEEDS_THE_SIDECAR_TO_UPLOAD,
  requireLocalMachine,
} from "@/cli/local-only";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";
import { draftIdArg } from "../entity-id";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { withSidecarDatabase } from "./sidecar-database";
import {
  jobLogPath,
  timeoutMsOf,
  timeoutOption,
  waitAndEmit,
} from "./job-wait";
import { POST_YOUTUBE_HELP } from "./video-post-youtube.help";

/**
 * `cvm video post-youtube`: queue the `youtube` Job the Post page queues —
 * the same kind, the same params, run by the same Sidecar — for a Landscape
 * Video, with a Thumbnail made in the CVM. Nothing here uploads.
 *
 * Every refusal (exit 3) is made BEFORE the Job is queued, so a refused run
 * leaves no row: the Thumbnail (`loadUploadableThumbnail`, the check the Job
 * itself makes), the export, the title and description, a live upload of
 * the same Video, and an earlier upload that already posted it.
 */

/** The privacy statuses this verb may ask for. Never `public`. */
export const CLI_PRIVACY_STATUSES = ["unlisted", "private"] as const;
type CliPrivacyStatus = (typeof CLI_PRIVACY_STATUSES)[number];

/** What the verb would queue, and what `--dry-run` prints. */
const planYouTubePost = Effect.fn("planYouTubePost")(function* (input: {
  readonly videoId: string;
  readonly thumbnailId: string;
  readonly privacyStatus: CliPrivacyStatus;
}) {
  const { videoId } = input;
  const video = yield* Effect.flatMap(VideoOperationsService, (svc) =>
    svc.getVideoWithClipsById(videoId)
  ).pipe(Effect.catchTag("NotFoundError", () => notFound("video", videoId)));
  if (video.archived) {
    return yield* parseError(`Video ${videoId} is archived`, "video");
  }
  if (video.format === "short") {
    return yield* parseError(
      `Video ${videoId} is a Short: Shorts go out through the Posting Queue ('cvm short post'), not this upload`,
      "video"
    );
  }

  // The YouTube Draft, as the Post page shows it: the Pitch's YouTube title
  // stands in for a title never typed.
  const pitchTitle =
    video.youtubeDraftTitle === null && video.pitchId
      ? yield* Effect.flatMap(PitchOperationsService, (svc) =>
          svc.getPitch(video.pitchId!)
        ).pipe(
          Effect.map((p) => p.youtubeTitle),
          Effect.catchTag("NotFoundError", () => Effect.succeed(""))
        )
      : "";
  const title = (video.youtubeDraftTitle ?? pitchTitle).trim();
  const description = (video.youtubeDraftDescription ?? "").trim();
  if (!title || !description) {
    return yield* parseError(
      `Video ${videoId} has no YouTube ${!title ? "title" : "description"}: write it on the Video's Post page first (its YouTube Draft)`,
      "video"
    );
  }
  const problem = findYouTubeMetadataProblem({ title, description });
  if (problem) return yield* parseError(problem.message, "video");

  const thumbnail = yield* loadUploadableThumbnail({
    thumbnailId: input.thumbnailId,
    videoId,
  });
  if (!thumbnail.onDisk) {
    return yield* parseError(
      `Thumbnail ${thumbnail.id}'s file is not on disk (${thumbnail.path}): open the Video's Thumbnail page and save it again, or pick another ('cvm thumbnail list --video ${videoId}')`,
      "thumbnail"
    );
  }

  const reads = yield* makeCoursePublishReads;
  const exportPath = yield* reads.resolveExportPath(video);
  if (!exportPath || !(yield* reads.isExported(video))) {
    return yield* parseError(
      `Video ${videoId} has not been exported: its export is not in finished-videos/ on any Storage Root. Export it from the Video's page in the CVM first.`,
      "video"
    );
  }

  return {
    videoId,
    title,
    description,
    privacyStatus: input.privacyStatus,
    export: { path: exportPath, sizeBytes: statSync(exportPath).size },
    thumbnail: {
      id: thumbnail.id,
      path: thumbnail.path,
      selectedForUpload: thumbnail.selectedForUpload,
    },
  };
});

/** A second upload of a Video while one is queued or running is refused. */
const refuseLiveUpload = Effect.fn("refuseLiveUpload")(function* (
  videoId: string
) {
  const ops = yield* JobOperationsService;
  for (const status of ["queued", "running"] as const) {
    const [live] = yield* ops.listJobs({
      kind: "youtube",
      status,
      videoId,
      limit: 1,
    });
    if (live) {
      return yield* parseError(
        `Video ${videoId} already has a YouTube upload ${status}: Job ${live.id}. Wait on it ('cvm job wait ${live.id}') rather than queueing another.`,
        "video"
      );
    }
  }
});

/**
 * A youtube Job that POSTED this Video before — whatever it ended as: one
 * that failed setting the Thumbnail still left the Video on YouTube — is
 * refused, so an agent retrying a failed upload never posts a duplicate.
 * `--again` is the author saying a second copy is what they want.
 */
const refusePostedUpload = Effect.fn("refusePostedUpload")(function* (
  videoId: string
) {
  const ops = yield* JobOperationsService;
  const posted = yield* ops.listSubjectJobEvents({
    kind: "youtube",
    subjectType: "video",
    subjectId: videoId,
    type: POSTED_EVENT,
  });
  const last = posted.at(-1);
  if (!last) return;
  const { youtubeVideoId, url } = (last.data ?? {}) as {
    youtubeVideoId?: unknown;
    url?: unknown;
  };
  return yield* parseError(
    `Video ${videoId} is already on YouTube: Job ${last.jobId} posted it as ${String(youtubeVideoId)} (${String(url)}), even if that Job then failed. Check it in YouTube Studio. Only if a second copy is really wanted, run again with --again.`,
    "video"
  );
});

const thumbnailOption = Options.text("thumbnail").pipe(
  Options.withDescription(
    "the CVM Thumbnail to upload, by id ('cvm thumbnail list --video <id>'); never a file path"
  )
);

const privacyOption = Options.choice("privacy", CLI_PRIVACY_STATUSES).pipe(
  Options.withDescription("unlisted (default) or private; never public"),
  Options.withDefault("unlisted" as CliPrivacyStatus)
);

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("print what would be queued, and queue nothing")
);

const againOption = Options.boolean("again").pipe(
  Options.withDescription(
    "upload even though an earlier youtube Job already posted this Video (a second copy on YouTube)"
  )
);

const waitOption = Options.boolean("wait").pipe(
  Options.withDescription(
    "wait for the upload Job to settle and print it (default: print the queued Job and return)"
  )
);

export const postYouTubeCmd = Command.make(
  "post-youtube",
  {
    thumbnail: thumbnailOption,
    privacy: privacyOption,
    dryRun: dryRunOption,
    again: againOption,
    wait: waitOption,
    timeout: timeoutOption,
    id: draftIdArg("video"),
  },
  ({ thumbnail, privacy, dryRun, again, wait, timeout, id: ref }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine(
        "cvm video post-youtube",
        NEEDS_THE_SIDECAR_TO_UPLOAD
      );
      const timeoutMs = yield* timeoutMsOf(timeout);
      const videoId = yield* ref;

      const run = Effect.gen(function* () {
        const plan = yield* planYouTubePost({
          videoId,
          thumbnailId: thumbnail,
          privacyStatus: privacy,
        });
        if (!again) yield* refusePostedUpload(videoId);
        if (dryRun) return yield* emitObject({ dryRun: true, ...plan });

        yield* refuseLiveUpload(videoId);
        const job = yield* enqueueJob({
          id: null,
          kind: "youtube",
          title: plan.title,
          params: {
            videoId,
            title: plan.title,
            description: plan.description,
            privacyStatus: plan.privacyStatus,
            thumbnailId: plan.thumbnail.id,
          },
          dependsOn: null,
          subject: { type: "video", id: videoId },
          attemptsSpent: 0,
          registry: JOB_KIND_SPECS,
        });
        // Best effort, and silent: a Sidecar that is down finds the Job when
        // it starts, and the CLI's STDERR is its error contract.
        yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));

        if (!wait) {
          return yield* emitObject({
            jobId: job.id,
            status: "queued",
            ...plan,
            log: jobLogPath(job.id),
          });
        }
        const [settled] = yield* waitAndEmit({ jobIds: [job.id], timeoutMs });
        yield* emitObject(settled);
      });

      // loadRepoEnv first: STORAGE_ROOTS and DATABASE_URL come from the
      // repo .env, and the export check needs a real filesystem.
      return yield* Effect.sync(() => loadRepoEnv()).pipe(
        Effect.zipRight(
          withSidecarDatabase(run).pipe(
            Effect.provide(NodeContext.layer),
            Effect.withConfigProvider(ConfigProvider.fromEnv())
          )
        )
      );
    })
).pipe(Command.withDescription(detail(POST_YOUTUBE_HELP)));
