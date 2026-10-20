import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { latestJobFor, visibleJobRows } from "./jobs-selectors";
import type { WireJob, WireJobEvent } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000af";

const autofillJob: WireJob = {
  id: JOB_ID,
  kind: "autofill",
  title: "Autofill Generics",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "course",
  subjectId: "course-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let nextEventId = 100;
const autofill = (type: string, data: Record<string, unknown> = {}) => {
  const event: WireJobEvent = {
    id: ++nextEventId,
    jobId: JOB_ID,
    type,
    data,
    at: "2026-10-09T12:00:00.000Z",
  };
  const action = toJobsAction({ job: autofillJob, event });
  if (!action) throw new Error(`no action for ${type}`);
  return action;
};

const announced = () =>
  autofill("videos", {
    videos: [
      { id: "video-a", title: "S1/L1/Intro" },
      { id: "video-b", title: "S1/L2/Generics" },
    ],
  });

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const rows = (state: jobsReducer.State) =>
  visibleJobRows(state).map((r) => ({
    uploadId: r.uploadId,
    title: r.title,
    status: r.status,
    parentUploadId: r.parentUploadId,
    ...(r.uploadType === "autofill" ? { stage: r.autofillStage } : {}),
  }));

describe("a Course Autofill Job", () => {
  it("draws a parent row and one child row per Video, as the browser-driven run did", () => {
    const tester = newTester()
      .send(autofill("started", { attempt: 1 }))
      .send(autofill("stage", { stage: "selecting" }));
    expect(rows(tester.getState())).toEqual([
      {
        uploadId: JOB_ID,
        title: "Autofill Generics",
        status: "uploading",
        parentUploadId: null,
        stage: "selecting",
      },
    ]);

    tester
      .send(announced())
      .send(autofill("stage", { stage: "writing" }))
      .send(autofill("video-succeeded", { videoId: "video-a" }));
    expect(rows(tester.getState())).toEqual([
      {
        uploadId: JOB_ID,
        title: "Autofill Generics",
        status: "uploading",
        parentUploadId: null,
        stage: "writing",
      },
      {
        uploadId: `${JOB_ID}/video-a`,
        title: "S1/L1/Intro",
        status: "success",
        parentUploadId: JOB_ID,
        stage: null,
      },
      {
        uploadId: `${JOB_ID}/video-b`,
        title: "S1/L2/Generics",
        status: "uploading",
        parentUploadId: JOB_ID,
        stage: "writing",
      },
    ]);
    // Half the Videos settled: half of the parent's work band.
    expect(visibleJobRows(tester.getState())[0]?.progress).toBe(50);
    // A filled Video does not toast on its own: the run's toast speaks for it.
    expect(tester.getEffects()).toEqual([]);
  });

  it("offers the text of a field the author changed mid-run on that Video's row", () => {
    const tester = newTester()
      .send(announced())
      .send(
        autofill("video-succeeded", {
          videoId: "video-a",
          fields: [],
          kept: [{ field: "description", proposal: "The Autofill's take" }],
        })
      );
    const row = visibleJobRows(tester.getState()).find(
      (r) => r.uploadId === `${JOB_ID}/video-a`
    );
    expect(row?.uploadType === "autofill" && row.kept).toEqual([
      { field: "description", proposal: "The Autofill's take" },
    ]);
    expect(tester.getEffects()).toEqual([]);

    // The offer waits for the author: idling never hides it.
    tester.send(autofill("succeeded")).send({ type: "idle-timeout-elapsed" });
    expect(visibleJobRows(tester.getState())).toHaveLength(3);
  });

  it("toasts a Video that failed by name, with the run's log, and carries on", () => {
    const tester = newTester()
      .send(announced())
      .send(
        autofill("video-failed", {
          videoId: "video-b",
          message: "the model said no",
        })
      );
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "autofill-video",
        title: "S1/L2/Generics",
        message: "the model said no",
        hasLog: true,
      },
    ]);
    expect(rows(tester.getState())[2]).toMatchObject({ status: "error" });
    expect(rows(tester.getState())[0]).toMatchObject({ status: "uploading" });
  });

  it("succeeds once, with its own toast, even when a Video failed", () => {
    const tester = newTester()
      .send(announced())
      .send(autofill("video-succeeded", { videoId: "video-a" }))
      .send(autofill("video-failed", { videoId: "video-b", message: "no" }))
      .send(autofill("succeeded"));
    expect(tester.getEffects()).toContainEqual({
      type: "show-job-succeeded-toast",
      jobId: JOB_ID,
      title: "Autofill Generics",
      // "<title> finished", with "Back to Publish".
      toast: { shape: "autofill", courseId: "course-1" },
    });
    expect(rows(tester.getState())[0]).toMatchObject({
      status: "success",
      stage: null,
    });
  });

  it("a run that fails toasts its cause once, with its log, and never retries", () => {
    const tester = newTester()
      .send(autofill("stage", { stage: "selecting" }))
      .send(
        autofill("failed", {
          error: {
            tag: "AutofillRunError",
            message:
              "Only a Draft Version can be autofilled — reload the publish page",
          },
        })
      );
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "autofill",
        title: "Autofill Generics",
        message:
          "Only a Draft Version can be autofilled — reload the publish page",
        hasLog: true,
      },
    ]);
    expect(rows(tester.getState())[0]).toMatchObject({ status: "error" });
  });

  it("a reopened tab finds the Course's running Autofill in the snapshot", () => {
    const tester = newTester().send({
      type: "job-snapshot-received",
      snapshot: {
        cursor: 999,
        jobs: [
          {
            job: autofillJob,
            events: [
              {
                id: 1,
                jobId: JOB_ID,
                type: "started",
                data: { attempt: 1 },
                at: "2026-10-09T12:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
    expect(
      latestJobFor(tester.getState(), "autofill", "course-1")
    ).toMatchObject({ id: JOB_ID, status: "running" });
    expect(latestJobFor(tester.getState(), "autofill", "course-2")).toBe(
      undefined
    );
  });
});
