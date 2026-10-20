import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { uploadStageLabel } from "@/features/upload-manager/upload-stage-labels";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000e1";
const NEW_COURSE_ID = "6b0c1f5e-0000-4000-8000-0000000000c0";

let nextEventId = 100;
const heard = (type: string, data: Record<string, unknown> = {}) => {
  const action = toJobsAction(
    {
      job: {
        id: JOB_ID,
        kind: "duplicate-course",
        title: "Cohort 003",
        attempt: 1,
        maxAttempts: 2,
        subjectType: "course",
        subjectId: NEW_COURSE_ID,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      event: {
        id: ++nextEventId,
        jobId: JOB_ID,
        type,
        data,
        at: "2026-10-09T12:00:00.000Z",
      },
    },
    Date.parse("2026-10-09T12:00:00.000Z")
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

describe("a duplicate-course Job", () => {
  it("draws one row about the new Course, its bar filled by the file copy", () => {
    const tester = started().send(
      heard("progress", { stage: "copying-files", percent: 50 })
    );
    const [row, ...rest] = jobUploadEntries(tester.getState().jobs[JOB_ID]!);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      uploadType: "duplicate-course",
      courseId: NEW_COURSE_ID,
      status: "uploading",
      progress: 54,
    });
    expect(uploadStageLabel(row!)).toBe("Copying frames and files");
  });

  it("shows no toast when it succeeds", () => {
    const tester = started().send(heard("succeeded"));
    expect(toastsOf(tester)).toEqual([]);
    expect(jobUploadEntries(tester.getState().jobs[JOB_ID]!)[0]).toMatchObject({
      status: "success",
      progress: 100,
    });
  });

  it.each(["failed", "interrupted"])("toasts when it is %s", (outcome) => {
    const tester = started().send(
      heard(outcome, {
        error: { message: "2 of 9 files did not reach the copy" },
      })
    );
    expect(toastsOf(tester)).toEqual(["show-job-failed-toast"]);
  });
});
