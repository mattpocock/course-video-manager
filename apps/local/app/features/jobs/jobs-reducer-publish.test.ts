import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import {
  jobUploadEntries,
  latestJobFor,
  publishRecoveryHrefOf,
} from "./jobs-selectors";
import { PUBLISH_INTERRUPTED_MESSAGE, type WireJob } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000bf";

const publishJob: WireJob = {
  id: JOB_ID,
  kind: "publish",
  title: "Generics",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "course",
  subjectId: "course-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let nextEventId = 100;
const publish = (type: string, data: Record<string, unknown> = {}) => {
  const action = toJobsAction({
    job: publishJob,
    event: {
      id: ++nextEventId,
      jobId: JOB_ID,
      type,
      data,
      at: "2026-10-09T12:00:00.000Z",
    },
  });
  if (!action) throw new Error(`no action for ${type}`);
  return action;
};

const announced = () =>
  publish("videos", {
    videos: [
      { id: "video-a", title: "S1/L1/Intro" },
      { id: "video-b", title: "S1/L2/Generics" },
    ],
  });

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const rowsOf = (state: jobsReducer.State) => {
  const job = state.jobs[JOB_ID];
  return job ? jobUploadEntries(job) : [];
};

describe("a Publish Job", () => {
  it("draws a parent row for the Course and one child row per shipping Video, as the browser-driven Publish did", () => {
    const tester = newTester()
      .send(publish("started", { attempt: 1 }))
      .send(publish("stage", { stage: "validating" }));
    expect(rowsOf(tester.getState())).toEqual([
      expect.objectContaining({
        uploadId: JOB_ID,
        uploadType: "publish",
        title: "Generics",
        status: "uploading",
        publishStage: "validating",
        courseId: "course-1",
        progress: 2,
      }),
    ]);

    tester
      .send(publish("stage", { stage: "cloning" }))
      .send(announced())
      .send(publish("video-upload-queued", { videoId: "video-b" }))
      .send(publish("stage", { stage: "exporting" }))
      .send(
        publish("video-stage", {
          videoId: "video-a",
          stage: "concatenating-clips",
        })
      )
      .send(
        publish("video-progress", {
          videoId: "video-a",
          stage: "concatenating-clips",
          percent: 50,
        })
      );
    const [parent, a, b] = rowsOf(tester.getState());
    expect(a).toMatchObject({
      uploadId: `${JOB_ID}/video-a`,
      parentUploadId: JOB_ID,
      uploadType: "export",
      isBatchEntry: true,
      exportStage: "concatenating-clips",
      videoUploadStage: null,
      // Half of the encode's 40-point band.
      progress: 20,
    });
    expect(b).toMatchObject({
      exportStage: null,
      videoUploadStage: "queued-for-upload",
      progress: 50,
    });
    // The parent's bar is its children's, inside the work band (10 + 89).
    expect(parent?.progress).toBe(10 + Math.floor((35 / 100) * 89));

    tester.send(publish("video-upload-queued", { videoId: "video-a" })).send(
      publish("video-upload-progress", {
        videoId: "video-a",
        uploadedBytes: 500,
        totalBytes: 1000,
      })
    );
    expect(rowsOf(tester.getState())[1]).toMatchObject({
      exportStage: null,
      videoUploadStage: "uploading",
      uploadedBytes: 500,
      totalBytes: 1000,
      progress: 74,
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("succeeds with the browser's toast: 'Go to Draft' needs the new Draft's id", () => {
    const tester = newTester()
      .send(announced())
      .send(publish("video-succeeded", { videoId: "video-a" }))
      .send(publish("video-succeeded", { videoId: "video-b" }))
      .send(publish("stage", { stage: "complete" }))
      .send(
        publish("published", {
          publishedVersionId: "version-1",
          newDraftVersionId: "version-2",
          lessons: { ships: 2, placeholders: 0, withheld: 0 },
        })
      )
      .send(publish("succeeded"));
    const [parent, ...children] = rowsOf(tester.getState());
    expect(parent).toMatchObject({
      status: "success",
      progress: 100,
      publishStage: null,
      newDraftVersionId: "version-2",
    });
    expect(children.map((c) => c.status)).toEqual(["success", "success"]);
    expect(tester.getEffects()).toContainEqual({
      type: "show-job-succeeded-toast",
      jobId: JOB_ID,
      title: "Generics",
      toast: {
        shape: "publish",
        courseId: "course-1",
        newDraftVersionId: "version-2",
      },
    });
  });

  it("a Video that fails toasts once, by name, with the log — a replayed failure or a later upload event does not reopen it", () => {
    const tester = newTester()
      .send(announced())
      .send(
        publish("video-failed", {
          videoId: "video-a",
          message: "Export failed: ffmpeg exited 1",
        })
      )
      // The Dropbox commit's in-service retry replays a Video's events.
      .send(publish("video-upload-queued", { videoId: "video-a" }))
      .send(publish("video-failed", { videoId: "video-a", message: "again" }));
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "publish-video",
        title: "S1/L1/Intro",
        message: "Export failed: ffmpeg exited 1",
        hasLog: true,
      },
    ]);
    expect(rowsOf(tester.getState())[1]).toMatchObject({
      status: "error",
      errorMessage: "Export failed: ffmpeg exited 1",
      videoUploadStage: null,
    });
  });

  it("a failed Publish toasts its real cause once, with its log, and its unfinished Videos draw as failed", () => {
    const message =
      "Publish discarded: the Dropbox commit failed (after one retry): DropboxApiError: 503. Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable";
    const tester = newTester()
      .send(announced())
      .send(publish("video-succeeded", { videoId: "video-a" }))
      .send(publish("failed", { error: { tag: "PublishRunError", message } }));
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "publish",
        title: "Generics",
        message,
        hasLog: true,
      },
    ]);
    const [parent, a, b] = rowsOf(tester.getState());
    expect(parent).toMatchObject({ status: "error", terminal: true });
    expect(a).toMatchObject({ status: "success" });
    expect(b).toMatchObject({ status: "error", errorMessage: message });
  });

  it("an interrupted Publish says it is never re-run and points at Promote / Discard", () => {
    const tester = newTester()
      .send(publish("started", { attempt: 1 }))
      .send(
        publish("interrupted", {
          error: {
            tag: "JobInterrupted",
            message: "The sidecar stopped while this job was running",
          },
        })
      );
    expect(rowsOf(tester.getState())[0]).toMatchObject({
      status: "error",
      errorMessage: PUBLISH_INTERRUPTED_MESSAGE,
    });
    expect(tester.getEffects()[0]).toMatchObject({
      type: "show-job-failed-toast",
      kind: "publish",
      message: PUBLISH_INTERRUPTED_MESSAGE,
    });
  });

  it("a reopened tab finds the Course's running Publish in the snapshot, with its Videos", () => {
    const tester = newTester().send({
      type: "job-snapshot-received",
      snapshot: {
        cursor: 999,
        jobs: [
          {
            job: publishJob,
            events: [
              {
                id: 1,
                jobId: JOB_ID,
                type: "started",
                data: { attempt: 1 },
                at: "2026-10-09T12:00:00.000Z",
              },
              {
                id: 2,
                jobId: JOB_ID,
                type: "videos",
                data: { videos: [{ id: "video-a", title: "S1/L1/Intro" }] },
                at: "2026-10-09T12:00:01.000Z",
              },
              {
                id: 3,
                jobId: JOB_ID,
                type: "video-upload-queued",
                data: { videoId: "video-a" },
                at: "2026-10-09T12:00:02.000Z",
              },
            ],
          },
        ],
      },
    });
    expect(
      latestJobFor(tester.getState(), "publish", "course-1")
    ).toMatchObject({ id: JOB_ID, status: "running" });
    expect(rowsOf(tester.getState())[1]).toMatchObject({
      videoUploadStage: "queued-for-upload",
    });
  });

  describe("points at Promote / Discard only when a Pending Version may be left", () => {
    const recoveryHref = (tester: ReturnType<typeof newTester>) => {
      const job = tester.getState().jobs[JOB_ID];
      return job ? publishRecoveryHrefOf(job) : null;
    };

    it("a Publish that fails after Submit (its Promote failed) points at the publish page", () => {
      const tester = newTester()
        .send(publish("started", { attempt: 1 }))
        .send(publish("stage", { stage: "freezing" }))
        .send(publish("submitted", { pendingVersionId: "version-1" }))
        .send(announced())
        .send(
          publish("failed", {
            error: {
              tag: "VersionNotPendingError",
              message: "version-1 is not pending",
            },
          })
        );
      expect(recoveryHref(tester)).toBe("/courses/course-1/publish");
    });

    it("a reopened tab folds Submit from the snapshot and still points there", () => {
      const at = "2026-10-09T12:00:00.000Z";
      const tester = newTester().send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 999,
          jobs: [
            {
              job: publishJob,
              events: [
                { id: 1, jobId: JOB_ID, type: "started", data: {}, at },
                { id: 2, jobId: JOB_ID, type: "submitted", data: {}, at },
                {
                  id: 3,
                  jobId: JOB_ID,
                  type: "failed",
                  data: { error: { tag: "DatabaseError", message: "x" } },
                  at,
                },
              ],
            },
          ],
        },
      });
      expect(recoveryHref(tester)).toBe("/courses/course-1/publish");
    });

    it("a Publish that fails before Submit leaves nothing Pending: no link", () => {
      const tester = newTester()
        .send(publish("started", { attempt: 1 }))
        .send(publish("stage", { stage: "validating" }))
        .send(
          publish("failed", {
            error: { tag: "DatabaseError", message: "connection lost" },
          })
        );
      expect(recoveryHref(tester)).toBeNull();
    });

    it("a failure the Publish already Discarded (export or Commit) offers no link", () => {
      for (const tag of ["PublishRunError", "PublishRefusedError"]) {
        const tester = newTester()
          .send(publish("started", { attempt: 1 }))
          .send(publish("submitted", { pendingVersionId: "version-1" }))
          .send(
            publish("failed", {
              error: { tag, message: "Publish discarded: …" },
            })
          );
        expect(recoveryHref(tester)).toBeNull();
      }
    });

    it("a Publish still running offers no link, even past Submit", () => {
      const tester = newTester()
        .send(publish("started", { attempt: 1 }))
        .send(publish("submitted", { pendingVersionId: "version-1" }));
      expect(recoveryHref(tester)).toBeNull();
    });

    it("an interrupted Publish points there as before, Submit seen or not", () => {
      const tester = newTester()
        .send(publish("started", { attempt: 1 }))
        .send(publish("interrupted", { error: { tag: "JobInterrupted" } }));
      expect(recoveryHref(tester)).toBe("/courses/course-1/publish");
    });
  });
});
