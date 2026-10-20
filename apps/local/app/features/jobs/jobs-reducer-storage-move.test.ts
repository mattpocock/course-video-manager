import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { uploadStageLabel } from "@/features/upload-manager/upload-stage-labels";
import {
  createInitialJobsState,
  isFinishedJob,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";

/** A Storage move's row (#2109): the one row with a Cancel. */

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000f1";

let nextEventId = 100;
const heard = (
  type: string,
  data: Record<string, unknown> = {},
  kind = "storage-move"
) => {
  const action = toJobsAction(
    {
      job: {
        id: JOB_ID,
        kind,
        title: "Move Crash Course Footage to E:",
        attempt: 1,
        maxAttempts: 2,
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

describe("a storage-move Job", () => {
  it("draws one row with its copy's progress and a Cancel", () => {
    const tester = started().send(
      heard("progress", { stage: "copying", percent: 50 })
    );
    const row = rowOf(tester);
    expect(row).toMatchObject({
      uploadType: "storage-move",
      status: "uploading",
      cancellable: true,
      cancelRequested: false,
    });
    expect(uploadStageLabel(row)).toBe("Copying and verifying checksums");
  });

  it("Cancel asks the server once, and the row says it is cancelling", () => {
    const tester = started()
      .send({ type: "press-cancel", id: JOB_ID })
      .send({ type: "press-cancel", id: JOB_ID });
    expect(
      tester
        .getEffects()
        .filter((e: { type: string }) => e.type === "cancel-job")
    ).toEqual([{ type: "cancel-job", id: JOB_ID }]);
    const row = rowOf(tester);
    expect(row).toMatchObject({ cancellable: false, cancelRequested: true });
    expect(uploadStageLabel(row)).toBe("Cancelling: removing partial copies");
  });

  it("ends cancelled, settled, without a failure toast", () => {
    const tester = started()
      .send(heard("cancel-requested"))
      .send(
        heard("cancelled", {
          ran: true,
          message: "Cancelled: partial copies were removed",
        })
      );
    const job = tester.getState().jobs[JOB_ID]!;
    expect(job.status).toBe("cancelled");
    expect(isFinishedJob(job)).toBe(true);
    expect(toastsOf(tester)).toEqual([]);
    expect(rowOf(tester)).toMatchObject({
      status: "error",
      cancelled: true,
      cancellable: false,
      errorMessage: "Cancelled: partial copies were removed",
    });
  });

  it("a Cancel the server refused toasts, and offers Cancel again", () => {
    const tester = started()
      .send({ type: "press-cancel", id: JOB_ID })
      .send({ type: "cancel-failed", id: JOB_ID, message: "Conflict" });
    expect(
      tester
        .getEffects()
        .some((e: { type: string }) => e.type === "show-cancel-failed-toast")
    ).toBe(true);
    expect(rowOf(tester)).toMatchObject({ cancellable: true });
  });

  it("offers no Cancel on a kind that can't be cancelled", () => {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState())
      .send(heard("started", { attempt: 1 }, "export"))
      .send({ type: "press-cancel", id: JOB_ID });
    expect(
      tester.getEffects().some((e: { type: string }) => e.type === "cancel-job")
    ).toBe(false);
  });
});
