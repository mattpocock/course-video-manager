import nodeFs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, exists, notExists, notInArray } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { assertUnder } from "@/services/assert-under";
import {
  lstatOrNull,
  messageOf,
  MOVE_PARTIAL_SUFFIX,
  StorageMoveFailedError,
} from "./move-io.server";
import { FOLDER_OF, folderRefusal } from "./move-plan.server";
import {
  MOVE_PARTIAL_EVENT,
  MOVE_PARTIALS_SWEPT_EVENT,
  STORAGE_MOVE_JOB_KIND,
  STORAGE_MOVE_KINDS,
  type StorageMoveKind,
} from "./move-wire";
import type { StorageRoots } from "./storage-roots";
import { delay as clockDelay, nowMs } from "@/packages/clock";

/**
 * A STORAGE MOVE'S PARTIAL COPIES, AND WHO MAY DELETE THEM (#2169).
 *
 * A move writes each file to `<dest>.cvm-move-partial` first. Wasted space on
 * a drive is a bad outcome, so no partial may outlive the Job that made it —
 * but a Job may delete only the partials it can prove it made:
 *
 * - it RECORDS each partial (a `move-partial` Job Event) before creating it;
 * - only a recorded path is ever deleted, never a pattern over the drive;
 * - the path must end in exactly `.cvm-move-partial`, lie strictly inside
 *   `<target>/<folder>` once every link is resolved (`assertUnder`), the
 *   folder must really be that folder (`folderRefusal`), the target must be
 *   one of the configured Storage Roots, and the thing there a regular file.
 */

/** What removing a set of partials did. */
export type PartialsRemoved = {
  readonly files: number;
  readonly bytes: number;
  /** Left where they are, and why: the drive was away, say. */
  readonly kept: readonly { readonly path: string; readonly reason: string }[];
};

/**
 * Remove these partials, each only if it passes every check above. A partial
 * already gone counts as removed. Never throws: what it could not remove is
 * in `kept`.
 */
export const removeOwnPartials = async (opts: {
  readonly partials: readonly string[];
  readonly target: string;
  readonly folder: string;
}): Promise<PartialsRemoved> => {
  const kept: { path: string; reason: string }[] = [];
  let files = 0;
  let bytes = 0;
  if (opts.partials.length === 0) return { files, bytes, kept };
  const targetFolder = path.join(opts.target, opts.folder);
  const online = await nodeFs.readdir(opts.target).then(
    () => true,
    () => false
  );
  const unsafe = online ? await folderRefusal(opts.target, opts.folder) : null;
  for (const partial of opts.partials) {
    if (!online) {
      kept.push({ path: partial, reason: `${opts.target} is Offline` });
      continue;
    }
    if (unsafe !== null) {
      kept.push({ path: partial, reason: unsafe });
      continue;
    }
    if (!partial.endsWith(MOVE_PARTIAL_SUFFIX)) {
      kept.push({ path: partial, reason: "not a partial copy's name" });
      continue;
    }
    let safe: string;
    try {
      safe = assertUnder(targetFolder, partial);
    } catch (error) {
      kept.push({ path: partial, reason: messageOf(error) });
      continue;
    }
    const info = await lstatOrNull(safe);
    if (info === null) continue; // already gone: nothing to waste
    if (!info.isFile()) {
      kept.push({ path: partial, reason: "not a regular file (a link?)" });
      continue;
    }
    try {
      await nodeFs.unlink(safe);
      files += 1;
      bytes += Number(info.size);
    } catch (error) {
      if ((await lstatOrNull(safe)) !== null) {
        kept.push({ path: partial, reason: messageOf(error) });
      }
    }
  }
  return { files, bytes, kept };
};

/**
 * Record a partial as `jobId`'s (a `move-partial` Job Event) before it is
 * made. A short database blip is waited out — up to `windowMs`, backing off
 * to 5 s — and past that it rejects, and the move stops without making it.
 */
export const partialRecorder =
  (db: Database, jobId: string, windowMs = 30_000) =>
  async (partial: string): Promise<void> => {
    const deadline = nowMs() + windowMs;
    for (let delay = 250; ; delay = Math.min(delay * 2, 5_000)) {
      try {
        await db.insert(jobEvents).values({
          jobId,
          type: MOVE_PARTIAL_EVENT,
          data: { path: partial },
        });
        return;
      } catch (error) {
        if (nowMs() + delay > deadline) throw error;
        await clockDelay(delay);
      }
    }
  };

/** The partials a storage-move Job recorded, in every run of it. */
export const recordedPartials = (db: Database, jobId: string) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({ data: jobEvents.data })
        .from(jobEvents)
        .where(
          and(
            eq(jobEvents.jobId, jobId),
            eq(jobEvents.type, MOVE_PARTIAL_EVENT)
          )
        )
        .orderBy(asc(jobEvents.id));
      const paths = new Set<string>();
      for (const { data } of rows) {
        const p = (data as { path?: unknown }).path;
        if (typeof p === "string") paths.add(p);
      }
      return [...paths];
    },
    catch: (cause) =>
      new StorageMoveFailedError({
        message: `Could not read or sweep partial copies: ${messageOf(cause)}`,
      }),
  });

const LIVE_STATUSES: ("queued" | "running")[] = ["queued", "running"];

const paramOf = (params: unknown, key: string): unknown =>
  typeof params === "object" && params !== null && key in params
    ? (params as Record<string, unknown>)[key]
    : undefined;

/**
 * THE SWEEP: every storage-move Job that is no longer queued or running and
 * recorded partials it has not yet swept gets them removed, and a
 * `move-partials-swept` Job Event once none is left. A Job whose drive is
 * Offline, or whose partials could not all go, is tried again next time. The
 * Sidecar runs it on start and after every recovery tick, so partials a
 * crash, a kill or a lapsed lease left are gone once the Job has ended.
 *
 * Each Job is swept inside a transaction holding its row (`FOR UPDATE`), and
 * only while it is still not queued or running: an author's Retry waits for
 * the sweep, and never resumes a partial being deleted under it.
 */
export const sweepEndedMovePartials = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
}) =>
  Effect.tryPromise({
    try: async () => {
      const candidates = await opts.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.kind, STORAGE_MOVE_JOB_KIND),
            notInArray(jobs.status, LIVE_STATUSES),
            exists(
              opts.db
                .select({ id: jobEvents.id })
                .from(jobEvents)
                .where(
                  and(
                    eq(jobEvents.jobId, jobs.id),
                    eq(jobEvents.type, MOVE_PARTIAL_EVENT)
                  )
                )
            ),
            notExists(
              opts.db
                .select({ id: jobEvents.id })
                .from(jobEvents)
                .where(
                  and(
                    eq(jobEvents.jobId, jobs.id),
                    eq(jobEvents.type, MOVE_PARTIALS_SWEPT_EVENT)
                  )
                )
            )
          )
        );
      const swept: { jobId: string; removed: PartialsRemoved }[] = [];
      for (const { id } of candidates) {
        const result = await opts.db.transaction(async (tx) => {
          const [job] = await tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.id, id), notInArray(jobs.status, LIVE_STATUSES)))
            .for("update");
          if (!job) return null; // queued again (a Retry): its to resume
          const target = paramOf(job.params, "target");
          const kind = paramOf(job.params, "kind");
          if (
            typeof target !== "string" ||
            !opts.roots.includes(target) ||
            !(STORAGE_MOVE_KINDS as readonly unknown[]).includes(kind)
          ) {
            return null; // not a Storage Root any more: never touched
          }
          const rows = await tx
            .select({ data: jobEvents.data })
            .from(jobEvents)
            .where(
              and(
                eq(jobEvents.jobId, id),
                eq(jobEvents.type, MOVE_PARTIAL_EVENT)
              )
            );
          const partials = [
            ...new Set(
              rows
                .map((r) => (r.data as { path?: unknown }).path)
                .filter((p): p is string => typeof p === "string")
            ),
          ];
          const removed = await removeOwnPartials({
            partials,
            target,
            folder: FOLDER_OF[kind as StorageMoveKind],
          });
          if (removed.kept.length === 0) {
            await tx.insert(jobEvents).values({
              jobId: id,
              type: MOVE_PARTIALS_SWEPT_EVENT,
              data: { files: removed.files, bytes: removed.bytes },
            });
          }
          return removed;
        });
        if (result) swept.push({ jobId: id, removed: result });
      }
      return swept;
    },
    catch: (cause) =>
      new StorageMoveFailedError({
        message: `Could not read or sweep partial copies: ${messageOf(cause)}`,
      }),
  });
