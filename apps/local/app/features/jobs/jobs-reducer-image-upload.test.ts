import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";
import type { WireJob } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000d1";

const jobOf = (kind: string): WireJob => ({
  id: JOB_ID,
  kind,
  title: "Upload images to Cloudinary",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

let nextEventId = 100;
const heard = (
  kind: string,
  type: string,
  data: Record<string, unknown> = {}
) => {
  const action = toJobsAction(
    {
      job: jobOf(kind),
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
    .filter(
      (e: { type: string }) =>
        e.type === "show-job-succeeded-toast" ||
        e.type === "show-job-failed-toast"
    )
    .map((e: { type: string }) => e.type);

// An image upload shows in the body it changed: no row, and a toast only
// when it fails.
describe.each(["upload-images", "remove-local-images"])("a %s Job", (kind) => {
  it("draws no Upload Manager row", () => {
    const tester = new ReducerTester(
      jobsReducer,
      createInitialJobsState()
    ).send(heard(kind, "started", { attempt: 1 }));
    expect(jobUploadEntries(tester.getState().jobs[JOB_ID]!)).toEqual([]);
  });

  it("shows no toast when it succeeds", () => {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState())
      .send(heard(kind, "started", { attempt: 1 }))
      .send(heard(kind, "succeeded"));
    expect(toastsOf(tester)).toEqual([]);
  });

  it.each(["failed", "interrupted"])("toasts when it is %s", (outcome) => {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState())
      .send(heard(kind, "started", { attempt: 1 }))
      .send(heard(kind, outcome, { error: { message: "Cloudinary said no" } }));
    expect(toastsOf(tester)).toEqual(["show-job-failed-toast"]);
  });
});
