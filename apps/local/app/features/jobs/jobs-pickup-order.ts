import type { UploadEntry } from "@/features/upload-manager/upload-entry";
import { batchVideoRowId, jobIdOfRow, type jobsReducer } from "./jobs-reducer";

/**
 * The Upload Manager's rows in the order their work is picked up:
 *
 * 1. finished (succeeded, failed, interrupted, cancelled), in the order they
 *    finished, oldest first;
 * 2. running;
 * 3. everything still waiting.
 *
 * Running and waiting rows go in the Sidecar's claim order, which is the
 * database's: `claimNextJob` takes a Lane's oldest `created_at` first, `id`
 * breaking a tie. A Job whose enqueue has not landed has no `created_at` yet
 * and goes last. A Batch export's Video rows keep their roster order.
 */
export const rowsInPickupOrder = (
  state: jobsReducer.State,
  rows: readonly UploadEntry[]
): UploadEntry[] =>
  rows
    .map((row, index) => keyOf(state, row, index))
    .sort(compareKeys)
    .map((key) => key.row);

const FINISHED = 0;
const RUNNING = 1;
const WAITING = 2;

interface SortKey {
  row: UploadEntry;
  phase: number;
  /** When a finished row's work stopped; `Infinity` while unknown. */
  endedAt: number;
  createdAt: number;
  jobId: string;
  index: number;
}

const isRunning = (row: UploadEntry, job: jobsReducer.JobView | undefined) => {
  if (job?.status !== "running") return false;
  if (job.kind !== "batch-export") return true;
  // A batch runs, but each of its Videos waits for a slot of its own.
  const video = job.videos?.find(
    (v) => batchVideoRowId(job.id, v.id) === row.uploadId
  );
  return video?.status === "running";
};

const phaseOf = (row: UploadEntry, job: jobsReducer.JobView | undefined) => {
  if (row.status === "success" || row.status === "error") return FINISHED;
  return isRunning(row, job) ? RUNNING : WAITING;
};

const keyOf = (
  state: jobsReducer.State,
  row: UploadEntry,
  index: number
): SortKey => {
  const jobId = jobIdOfRow(row.uploadId);
  const job = state.jobs[jobId];
  return {
    row,
    phase: phaseOf(row, job),
    endedAt: state.timings[row.uploadId]?.endedAt ?? Infinity,
    createdAt: job?.createdAt ?? Infinity,
    jobId,
    index,
  };
};

/** Ascending, where two `Infinity`s are equal rather than `NaN`. */
const ascending = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

const compareKeys = (a: SortKey, b: SortKey): number =>
  ascending(a.phase, b.phase) ||
  (a.phase === FINISHED ? ascending(a.endedAt, b.endedAt) : 0) ||
  ascending(a.createdAt, b.createdAt) ||
  (a.jobId === b.jobId ? 0 : a.jobId < b.jobId ? -1 : 1) ||
  ascending(a.index, b.index);
