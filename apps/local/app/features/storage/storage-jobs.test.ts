import { describe, expect, it } from "vitest";
import {
  createInitialJobsState,
  type jobsReducer,
} from "@/features/jobs/jobs-reducer";
import {
  shownStorageJobs,
  storageJobsOf,
  watchStorageJobs,
} from "./storage-jobs";

const job = (over: Partial<jobsReducer.JobView>): jobsReducer.JobView => ({
  id: "j",
  kind: "storage-delete",
  title: "Move Unused Footage to the Trash",
  subjectType: "storage-bucket",
  subjectId: "unused-footage",
  status: "running",
  attempt: 1,
  stage: "deleting",
  percent: 40,
  errorMessage: null,
  errorTag: null,
  dependsOn: null,
  createdAt: 1,
  enqueued: true,
  result: null,
  postCheck: null,
  submitted: false,
  cancelRequested: false,
  lastEventId: 1,
  videos: null,
  ...over,
});

const stateOf = (...jobs: jobsReducer.JobView[]): jobsReducer.State => ({
  ...createInitialJobsState(),
  jobs: Object.fromEntries(jobs.map((j) => [j.id, j])),
});

const labelOf = (l: string) => (l === "/mnt/d" ? "D:" : l);

describe("storage Jobs on the Storage pages", () => {
  it("draws a running delete with its progress and Cancel, and a settled one with its result", () => {
    const views = storageJobsOf(
      stateOf(
        job({ id: "a" }),
        job({
          id: "b",
          status: "failed",
          errorMessage: "1 file still on D:",
          result: {
            bucketId: "unused-footage",
            operation: "trash-unused",
            location: null,
            deleted: { files: 2, bytes: 2 * 1024 ** 3 },
            kept: { files: 0, bytes: 0 },
            left: [{ path: "D: raw-footage/x.mkv", message: "EBUSY" }],
          },
        }),
        job({ id: "c", kind: "export", subjectId: "v" })
      ),
      "unused-footage",
      labelOf
    );
    expect(views.map((v) => [v.id, v.live, v.cancellable, v.percent])).toEqual([
      ["b", false, false, 40],
      ["a", true, true, 40],
    ]);
    expect(views[0]!.summary).toBe(
      "2 moved to the Trash (2.0 GB); 1 file still on its drive, retry"
    );
    expect(views[0]!.left).toEqual([
      { path: "D: raw-footage/x.mkv", message: "EBUSY" },
    ]);
  });

  it("shows only live Jobs and the ones the page saw run", () => {
    const views = storageJobsOf(
      stateOf(job({ id: "old", status: "succeeded" }), job({ id: "new" })),
      null,
      labelOf
    );
    expect(shownStorageJobs(views, {}).map((v) => v.id)).toEqual(["new"]);
    expect(shownStorageJobs(views, { old: false }).map((v) => v.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("a Job settles once it was seen live; one first seen settled does not", () => {
    const first = watchStorageJobs({}, [
      { id: "a", live: true },
      { id: "b", live: false },
    ]);
    expect(first).toEqual({ watched: { a: true }, settled: false });
    expect(watchStorageJobs(first.watched, [{ id: "a", live: false }])).toEqual(
      { watched: { a: false }, settled: true }
    );
  });
});
