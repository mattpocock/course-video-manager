import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { uploadStageLabel } from "@/features/upload-manager/upload-stage-labels";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";

/** A Storage delete's row (#2110): progress, a Cancel, and "N files still on D:, retry". */

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000f1";

let nextEventId = 100;
const heard = (
  type: string,
  data: Record<string, unknown> = {},
  kind = "storage-delete"
) => {
  const action = toJobsAction(
    {
      job: {
        id: JOB_ID,
        kind,
        title: "Delete Crash Course originals on D:",
        attempt: 1,
        maxAttempts: 1,
        subjectType: "storage-bucket",
        subjectId: "course:c1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      event: {
        id: ++nextEventId,
        jobId: JOB_ID,
        type,
        data,
        at: "2026-10-13T12:00:00.000Z",
      },
    },
    Date.parse("2026-10-13T12:00:00.000Z")
  );
  if (!action) throw new Error(`no action for ${type}`);
  return action;
};

const toastsOf = (tester: ReducerTester<any, any, any>) =>
  tester
    .getEffects()
    .map((e: { type: string }) => e.type)
    .filter((type: string) => type.startsWith("show-job-"));

const started = () =>
  new ReducerTester(jobsReducer, createInitialJobsState()).send(
    heard("started", { attempt: 1 })
  );

const rowOf = (tester: ReducerTester<any, any, any>) =>
  jobUploadEntries(tester.getState().jobs[JOB_ID]!)[0]!;

describe("a storage-delete Job", () => {
  it("draws one row with its progress and a Cancel", () => {
    const tester = started().send(
      heard("progress", { stage: "deleting", percent: 40 })
    );
    const row = rowOf(tester);
    expect(row).toMatchObject({
      uploadType: "storage-delete",
      status: "uploading",
      cancellable: true,
      cancelRequested: false,
    });
    expect(row.progress).toBeGreaterThan(2);
    expect(uploadStageLabel(row)).toBe(
      "Checking each file against its copy, then deleting"
    );
  });

  it("a file left fails it with 'N files still on D:, retry', and toasts it", () => {
    const message =
      "1 deleted (2.0 GB); 1 file still on D:, retry: raw-footage/a.mkv: EBUSY";
    const tester = started().send(
      heard("failed", { error: { message }, attempt: 1, willRetry: false })
    );
    expect(rowOf(tester)).toMatchObject({
      uploadType: "storage-delete",
      status: "error",
      cancelled: false,
      errorMessage: message,
    });
    expect(toastsOf(tester)).toEqual(["show-job-failed-toast"]);
  });

  it("ends cancelled without a failure toast", () => {
    const tester = started()
      .send(heard("cancel-requested"))
      .send(
        heard("cancelled", {
          ran: true,
          message: "Cancelled: 1 originals were deleted",
        })
      );
    expect(toastsOf(tester)).toEqual([]);
    expect(rowOf(tester)).toMatchObject({ status: "error", cancelled: true });
  });
});
