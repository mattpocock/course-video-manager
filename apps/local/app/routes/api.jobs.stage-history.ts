import { Effect } from "effect";
import {
  JobOperationsService,
  STAGE_HISTORY_JOBS_PER_KIND,
} from "@cvm/core/services/db-job-operations.server";
import { makeLoader } from "@/services/route-action.server";
import type { JobStageHistoryMessage } from "@/features/jobs/job-wire";

/**
 * The ETA's stage history: the newest succeeded Jobs of each kind with their
 * Job Events (`listJobStageHistory`), in the stream's wire shape. The browser
 * folds them as it folds the stream (`features/jobs/job-stage-history.ts`).
 * Read-only.
 */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const history = yield* ops.listJobStageHistory({
        perKind: STAGE_HISTORY_JOBS_PER_KIND,
      });
      const message: JobStageHistoryMessage = {
        jobs: history.map(({ job, events }) => ({
          job: {
            id: job.id,
            kind: job.kind,
            title: job.title,
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
            subjectType: job.subjectType,
            subjectId: job.subjectId,
            createdAt: job.createdAt.toISOString(),
          },
          events: events.map((event) => ({
            id: event.id,
            jobId: event.jobId,
            type: event.type,
            data: (event.data ?? {}) as Record<string, unknown>,
            at: event.at.toISOString(),
          })),
        })),
      };
      return Response.json(message);
    }),
});
