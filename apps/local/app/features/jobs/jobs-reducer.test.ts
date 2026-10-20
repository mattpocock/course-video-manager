import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntry, visibleJobRows, visibleJobs } from "./jobs-selectors";
import type { WireJob, WireJobEvent } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-000000000001";

const wireJob = (overrides: Partial<WireJob> = {}): WireJob => ({
  id: JOB_ID,
  kind: "export",
  title: "Intro to Generics",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

let nextEventId = 100;
const wireEvent = (
  type: string,
  data: Record<string, unknown> = {},
  id = ++nextEventId
): WireJobEvent => ({
  id,
  jobId: JOB_ID,
  type,
  data,
  at: "2026-10-08T12:00:00.000Z",
});

/** A Job Event off the stream, as the bridge dispatches it. */
const streamed = (event: WireJobEvent, job: WireJob = wireJob()) => {
  const action = toJobsAction({ job, event });
  if (!action) throw new Error(`no action for ${event.type}`);
  return action;
};

const requestExport = (): jobsReducer.Action => ({
  type: "job-requested",
  id: JOB_ID,
  kind: "export",
  title: "Intro to Generics",
  params: { videoId: "video-1" },
  subject: { type: "video", id: "video-1" },
  attemptsSpent: 0,
  dependsOn: null,
});

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const row = (state: jobsReducer.State) => {
  const job = state.jobs[JOB_ID];
  return job ? jobUploadEntry(job) : null;
};

describe("jobsReducer", () => {
  it("an export the tab asks for is enqueued, then drawn from its Job Events until it succeeds", () => {
    const tester = newTester().send(requestExport());
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "queued",
      progress: 0,
    });

    tester
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(streamed(wireEvent("stage", { stage: "concatenating-clips" })))
      .send(
        streamed(
          wireEvent("progress", { stage: "concatenating-clips", percent: 50 })
        )
      );
    // Concatenating owns 0–80 of the bar, exactly as the browser export drew it.
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "concatenating-clips",
      progress: 40,
    });

    tester.send(streamed(wireEvent("succeeded", { attempt: 1 })));
    expect(row(tester.getState())).toMatchObject({
      status: "success",
      progress: 100,
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "enqueue-job",
        id: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        params: { videoId: "video-1" },
        subject: { type: "video", id: "video-1" },
        attemptsSpent: 0,
        dependsOn: null,
        checks: 0,
        afterMs: 0,
      },
      {
        type: "show-job-succeeded-toast",
        jobId: JOB_ID,
        title: "Intro to Generics",
        toast: {
          shape: "generic",
          did: "exported successfully",
          revealVideoId: "video-1",
        },
      },
      // Its stages join the ETA's stage history.
      { type: "load-stage-history", requestId: 1 },
    ]);
  });

  it("a failing export shows each retry, then toasts its last failure once, with its log", () => {
    const error = (message: string) => ({
      error: { tag: "ExportError", message, cause: message },
    });
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(
        streamed(
          wireEvent("retrying", {
            failedAttempt: 1,
            nextAttempt: 2,
            ...error("ffmpeg exited 1"),
          })
        )
      );
    expect(row(tester.getState())).toMatchObject({
      status: "retrying",
      retryCount: 1,
      errorMessage: "ffmpeg exited 1",
    });

    const failed = wireEvent("failed", {
      attempt: 3,
      ...error("Failed to composite Overlays"),
    });
    tester.send(streamed(failed));
    // The same event again (a snapshot and the live feed can both carry it).
    tester.send(streamed(failed));

    expect(row(tester.getState())).toMatchObject({
      status: "error",
      errorMessage: "Failed to composite Overlays",
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "Failed to composite Overlays",
        hasLog: true,
      },
    ]);
  });

  it("a reopened tab picks a running export up from the snapshot, without toasting what already happened", () => {
    const tester = newTester().send({
      type: "job-snapshot-received",
      snapshot: {
        // The newest of the five events below: what follows is live.
        cursor: nextEventId + 5,
        jobs: [
          {
            job: wireJob(),
            events: [
              wireEvent("queued"),
              wireEvent("started", { attempt: 1 }),
              wireEvent("stage", { stage: "normalizing-audio" }),
              wireEvent("progress", {
                stage: "normalizing-audio",
                percent: 0,
              }),
            ],
          },
          {
            job: wireJob({ id: "finished-earlier", title: "Old one" }),
            events: [wireEvent("succeeded")],
          },
        ],
      },
    });

    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "normalizing-audio",
      progress: 80,
    });
    expect(tester.getState().sidecar).toBe("running");

    tester.send(streamed(wireEvent("succeeded")));
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "load-stage-history",
      "show-job-succeeded-toast",
      "load-stage-history",
    ]);
  });

  // The stream's catch-up re-sends the last minute of Job Events after the
  // snapshot, older than its cursor: a Job already finished, or dismissed (so
  // the snapshot left it out), arrives again in a tab that never watched it.
  it("a new tab toasts nothing for a Job the catch-up replays: only a settlement heard live is news", () => {
    const tester = newTester().send({
      type: "job-snapshot-received",
      snapshot: { cursor: 10_000, jobs: [] },
    });
    tester
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(streamed(wireEvent("succeeded")))
      .send(
        streamed(
          wireEvent("failed", { error: { message: "disk full" } }),
          wireJob({ id: "failed-earlier", title: "Old one" })
        )
      );

    // The snapshot's stage-history load, and no toast.
    expect(tester.getEffects()).toEqual([
      { type: "load-stage-history", requestId: 1 },
    ]);
  });

  it("a new tab toasts nothing for a Batch export Video the catch-up replays", () => {
    const batch = wireJob({ kind: "batch-export", title: "Export all" });
    const tester = newTester()
      .send({
        type: "job-snapshot-received",
        snapshot: { cursor: 10_000, jobs: [] },
      })
      .send(
        streamed(
          wireEvent("videos", { videos: [{ id: "video-a", title: "Intro" }] }),
          batch
        )
      )
      .send(
        streamed(wireEvent("video-succeeded", { videoId: "video-a" }), batch)
      );

    expect(tester.getEffects()).toEqual([
      { type: "load-stage-history", requestId: 1 },
    ]);
  });

  // LATE COMMITS (job-event-feed.ts): the cursor is the newest id visible
  // then; a settlement with a lower id can commit, and stream, after it.
  it("a Job the snapshot showed running toasts its late-committed settlement, below the cursor, once", () => {
    const running = [wireEvent("queued", {}, 5), wireEvent("started", {}, 6)];
    const tester = newTester()
      .send(streamed(wireEvent("queued", {}, 5)))
      .send({
        type: "job-snapshot-received",
        snapshot: { cursor: 300, jobs: [{ job: wireJob(), events: running }] },
      })
      .send(streamed(wireEvent("succeeded", {}, 7)))
      .send(streamed(wireEvent("succeeded", {}, 7)));

    expect(tester.getState().jobs[JOB_ID]?.status).toBe("succeeded");
    // Its stages join the history, as any live success's do.
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "load-stage-history",
      "show-job-succeeded-toast",
      "load-stage-history",
    ]);
  });

  it("a settlement the snapshot already announced is not announced again when the catch-up replays it", () => {
    const running = [wireEvent("queued", {}, 5), wireEvent("started", {}, 6)];
    const tester = newTester()
      .send({
        type: "job-snapshot-received",
        snapshot: { cursor: 6, jobs: [{ job: wireJob(), events: running }] },
      })
      .send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 300,
          jobs: [
            {
              job: wireJob(),
              events: [...running, wireEvent("succeeded", {}, 7)],
            },
          ],
        },
      })
      .send(streamed(wireEvent("succeeded", {}, 7)));

    expect(
      tester.getEffects().filter((e) => e.type === "show-job-succeeded-toast")
    ).toHaveLength(1);
  });

  it("a Job this tab followed that settled while the stream was down is announced when the snapshot shows it", () => {
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 900,
          jobs: [
            {
              job: wireJob(),
              events: [
                wireEvent("queued"),
                wireEvent("started"),
                wireEvent("failed", { error: { message: "disk full" } }),
              ],
            },
          ],
        },
      });

    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "disk full",
        hasLog: true,
      },
      { type: "load-stage-history", requestId: 1 },
    ]);
  });

  it("a Job put back by a stopping sidecar waits as queued, not as a retry, and carries on", () => {
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(streamed(wireEvent("requeued", { attempt: 1 })));
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "queued",
      retryCount: 0,
    });
    tester.send(streamed(wireEvent("started", { attempt: 1 })));
    expect(row(tester.getState())?.status).toBe("uploading");
    expect(tester.getEffects()).toEqual([]);
  });

  it("an export asked for while the sidecar is down is still queued, and the author is told why it waits", () => {
    const tester = newTester()
      .send({ type: "sidecar-unavailable", message: "nothing on the socket" })
      .send(requestExport());
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "enqueue-job",
      "show-sidecar-not-running-toast",
    ]);
    expect(tester.getState().sidecar).toBe("not-running");
  });

  it("an enqueue the server refuses fails the row and anything waiting on it", () => {
    const tester = newTester()
      .send(requestExport())
      .resetExec()
      .send({ type: "enqueue-failed", id: JOB_ID, message: "HTTP 500" });
    expect(row(tester.getState())).toMatchObject({
      status: "error",
      errorMessage: "HTTP 500",
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "HTTP 500",
        hasLog: false,
      },
    ]);
  });

  it("dismissing hides a row; the idle timer hides only the finished ones", () => {
    const other = wireJob({ id: "other", title: "Still going" });
    const tester = newTester()
      .send(streamed(wireEvent("succeeded")))
      .send(streamed({ ...wireEvent("queued"), jobId: "other" }, other))
      .send({ type: "idle-timeout-elapsed" });
    expect(visibleJobs(tester.getState()).map((j) => j.id)).toEqual(["other"]);
    tester.send({ type: "press-dismiss", id: "other" });
    expect(visibleJobs(tester.getState())).toEqual([]);
  });

  it("a settled Job's Dismiss is kept on the server, a running one's is not, and a dismissal from another tab hides it here", () => {
    const failedJob = wireJob({ id: "failed", title: "Broke" });
    const runningJob = wireJob({ id: "running", title: "Going" });
    const tester = newTester()
      .send(streamed(wireEvent("succeeded")))
      .send(
        streamed(
          {
            ...wireEvent("failed", { error: { message: "x" } }),
            jobId: "failed",
          },
          failedJob
        )
      )
      .send(streamed({ ...wireEvent("started"), jobId: "running" }, runningJob))
      // The idle timer takes only the succeeded Job: a failure needs Matt.
      .send({ type: "idle-timeout-elapsed" });
    expect(visibleJobs(tester.getState()).map((j) => j.id)).toEqual([
      "failed",
      "running",
    ]);
    expect(tester.getEffects().at(-1)).toEqual({
      type: "dismiss-jobs",
      ids: [JOB_ID],
    });

    const before = tester.getEffects().length;
    tester.send({ type: "press-dismiss", id: "running" });
    expect(tester.getEffects()).toHaveLength(before);

    tester.send({ type: "press-clear-finished" });
    expect(tester.getEffects().at(-1)).toEqual({
      type: "dismiss-jobs",
      ids: ["failed"],
    });

    const elsewhere = newTester()
      .send(
        streamed(
          {
            ...wireEvent("failed", { error: { message: "x" } }),
            jobId: "failed",
          },
          failedJob
        )
      )
      .send(
        streamed({ ...wireEvent("dismissed"), jobId: "failed" }, failedJob)
      );
    expect(visibleJobs(elsewhere.getState())).toEqual([]);
  });

  describe("a vertical Shorts render", () => {
    const renderJob = wireJob({ kind: "render-vertical", title: "My Short" });
    const render = (type: string, data: Record<string, unknown> = {}) =>
      streamed(wireEvent(type, data), renderJob);

    it("draws as the render-vertical row it was in the browser, stage by stage", () => {
      const tester = newTester().send({
        type: "job-requested",
        id: JOB_ID,
        kind: "render-vertical",
        title: "My Short",
        params: { videoId: "video-1" },
        subject: { type: "video", id: "video-1" },
        attemptsSpent: 0,
        dependsOn: null,
      });
      expect(row(tester.getState())).toMatchObject({
        uploadType: "render-vertical",
        status: "uploading",
        renderVerticalStage: null,
        progress: 0,
      });

      tester
        .send(render("queued"))
        .send(render("started", { attempt: 1 }))
        .send(render("stage", { stage: "rendering-overlay" }));
      // Each stage is a floor of the bar, as the browser render drew it.
      expect(row(tester.getState())).toMatchObject({
        status: "uploading",
        renderVerticalStage: "rendering-overlay",
        progress: 60,
      });

      tester.send(render("stage", { stage: "compositing" }));
      expect(row(tester.getState())).toMatchObject({ progress: 85 });

      tester.send(render("succeeded"));
      expect(row(tester.getState())).toMatchObject({
        status: "success",
        progress: 100,
        renderVerticalStage: null,
      });
    });

    it("a render that fails every attempt toasts once, with its log", () => {
      const error = {
        error: {
          tag: "RenderVerticalError",
          message: "Overlay renderer exited with code 1",
          cause: "Overlay renderer exited with code 1",
        },
      };
      const tester = newTester()
        .send(render("started", { attempt: 1 }))
        .send(render("retrying", { nextAttempt: 2, ...error }));
      expect(row(tester.getState())).toMatchObject({
        status: "retrying",
        retryCount: 1,
      });
      tester.send(render("failed", error));
      expect(row(tester.getState())).toMatchObject({
        status: "error",
        errorMessage: "Overlay renderer exited with code 1",
      });
      expect(tester.getEffects()).toEqual([
        {
          type: "show-job-failed-toast",
          jobId: JOB_ID,
          kind: "render-vertical",
          title: "My Short",
          message: "Overlay renderer exited with code 1",
          hasLog: true,
        },
      ]);
    });
  });

  describe("a Batch export", () => {
    const batchJob = wireJob({
      kind: "batch-export",
      title: "Export all: Generics",
      maxAttempts: 1,
      subjectType: "course-version",
      subjectId: "version-1",
    });
    const batch = (type: string, data: Record<string, unknown> = {}) =>
      streamed(wireEvent(type, data), batchJob);
    const announced = () =>
      batch("videos", {
        videos: [
          { id: "video-a", title: "S1/L1/Intro" },
          { id: "video-b", title: "S1/L2/Generics" },
        ],
      });
    const rows = (state: jobsReducer.State) =>
      visibleJobRows(state).map((r) => ({
        uploadId: r.uploadId,
        title: r.title,
        status: r.status,
        ...(r.uploadType === "export"
          ? { exportStage: r.exportStage, isBatchEntry: r.isBatchEntry }
          : {}),
      }));

    it("draws one export row per Video, toasts each as it lands, and hands a failed one's row to its own Job", () => {
      const tester = newTester()
        .send(batch("started", { attempt: 1 }))
        .send(announced())
        .send(
          batch("video-stage", {
            videoId: "video-a",
            stage: "concatenating-clips",
          })
        );
      expect(rows(tester.getState())).toEqual([
        {
          uploadId: `${JOB_ID}/video-a`,
          title: "S1/L1/Intro",
          status: "uploading",
          exportStage: "concatenating-clips",
          isBatchEntry: true,
        },
        {
          uploadId: `${JOB_ID}/video-b`,
          title: "S1/L2/Generics",
          status: "uploading",
          exportStage: "queued",
          isBatchEntry: true,
        },
      ]);

      tester
        .send(batch("video-succeeded", { videoId: "video-a" }))
        .send(
          batch("video-failed", { videoId: "video-b", message: "ffmpeg 1" })
        )
        .send(batch("video-handed-off", { videoId: "video-b", jobId: "other" }))
        .send(batch("succeeded"));
      expect(rows(tester.getState()).map((r) => r.uploadId)).toEqual([
        `${JOB_ID}/video-a`,
      ]);
      // Each Video toasts as the browser's rows did; the batch itself says
      // nothing when it succeeds.
      expect(tester.getEffects()).toEqual([
        {
          type: "show-job-succeeded-toast",
          jobId: JOB_ID,
          title: "S1/L1/Intro",
          // A Batch export's Video toasts as an export of its own: Open.
          toast: {
            shape: "generic",
            did: "exported successfully",
            revealVideoId: "video-a",
          },
        },
        { type: "load-stage-history", requestId: 1 },
      ]);
    });

    it("a batch that fails leaves its unfinished Videos failed, and toasts once with its log", () => {
      const tester = newTester()
        .send(announced())
        .send(batch("video-succeeded", { videoId: "video-a" }))
        .send(
          batch("failed", {
            error: { tag: "NotFoundError", message: "Version not found" },
          })
        );
      expect(
        visibleJobRows(tester.getState()).map((r) => [r.title, r.status])
      ).toEqual([
        ["S1/L1/Intro", "success"],
        ["S1/L2/Generics", "error"],
      ]);
      expect(tester.getEffects()).toContainEqual({
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "batch-export",
        title: "Export all: Generics",
        message: "Version not found",
        hasLog: true,
      });
    });

    it("a reopened tab redraws the batch from the snapshot without toasting what already landed", () => {
      const event = (type: string, data: Record<string, unknown> = {}) =>
        wireEvent(type, data);
      const tester = newTester().send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 999,
          jobs: [
            {
              job: batchJob,
              events: [
                event("started", { attempt: 1 }),
                event("videos", {
                  videos: [
                    { id: "video-a", title: "S1/L1/Intro" },
                    { id: "video-b", title: "S1/L2/Generics" },
                  ],
                }),
                event("video-succeeded", { videoId: "video-a" }),
                event("video-progress", {
                  videoId: "video-b",
                  stage: "normalizing-audio",
                  percent: 50,
                }),
              ],
            },
          ],
        },
      });
      expect(
        visibleJobRows(tester.getState()).map((r) => [r.title, r.status])
      ).toEqual([
        ["S1/L1/Intro", "success"],
        ["S1/L2/Generics", "uploading"],
      ]);
      expect(tester.getEffects()).toEqual([
        { type: "load-stage-history", requestId: 1 },
      ]);
    });

    it("dismissing one Video's row hides only that row", () => {
      const tester = newTester()
        .send(announced())
        .send({ type: "press-dismiss", id: `${JOB_ID}/video-a` });
      expect(visibleJobRows(tester.getState()).map((r) => r.title)).toEqual([
        "S1/L2/Generics",
      ]);
    });
  });
});
