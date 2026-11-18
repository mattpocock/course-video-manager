import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs, type JobStatus } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { makeDbCall } from "./db-job-calls.server.js";

/** Reading Jobs and their events. Part of `JobOperationsService`. */
export const createJobReadOperations = (db: Database) => {
  const getJob = Effect.fn("getJob")(function* (jobId: string) {
    const [job] = yield* makeDbCall(() =>
      db.select().from(jobs).where(eq(jobs.id, jobId))
    );
    return job;
  });

  const listJobEvents = Effect.fn("listJobEvents")(function* (jobId: string) {
    return yield* makeDbCall(() =>
      db
        .select()
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(asc(jobEvents.id))
    );
  });

  /**
   * `cvm job list`: Jobs newest first, narrowed by kind, status and the
   * Video they are about (subject `video`).
   */
  const listJobs = Effect.fn("listJobs")(function* (input: {
    readonly kind?: string;
    readonly status?: JobStatus;
    readonly videoId?: string;
    readonly limit: number;
  }) {
    const filters: SQL[] = [];
    if (input.kind !== undefined) filters.push(eq(jobs.kind, input.kind));
    if (input.status !== undefined) {
      filters.push(eq(jobs.status, input.status));
    }
    if (input.videoId !== undefined) {
      filters.push(eq(jobs.subjectType, "video"));
      filters.push(eq(jobs.subjectId, input.videoId));
    }
    return yield* makeDbCall(() =>
      db
        .select()
        .from(jobs)
        .where(and(...filters))
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(input.limit)
    );
  });

  return { getJob, listJobEvents, listJobs };
};
