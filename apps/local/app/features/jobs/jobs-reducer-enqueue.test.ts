import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  ENQUEUE_UNCONFIRMED_MESSAGE,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntry } from "./jobs-selectors";
import type { WireJob, WireJobEvent } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-000000000001";

const postJob: WireJob = {
  id: JOB_ID,
  kind: "youtube",
  title: "Intro to Generics",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const queuedEvent: WireJobEvent = {
  id: 101,
  jobId: JOB_ID,
  type: "queued",
  data: { kind: "youtube", lane: "posting", dependsOn: null },
  at: "2026-10-08T12:00:00.000Z",
};

const requestPost = (
  id = JOB_ID,
  dependsOn: string | null = null
): jobsReducer.Action => ({
  type: "job-requested",
  id,
  kind: "youtube",
  title: "Intro to Generics",
  params: { videoId: "video-1" },
  subject: { type: "video", id: "video-1" },
  attemptsSpent: 0,
  dependsOn,
});

const firstEnqueue = (
  tester: ReducerTester<
    jobsReducer.State,
    jobsReducer.Action,
    jobsReducer.Effect
  >
) => {
  const effect = tester
    .getEffects()
    .find(
      (e): e is jobsReducer.EnqueueJobEffect =>
        e.type === "enqueue-job" && e.id === JOB_ID
    );
  if (!effect) throw new Error("no enqueue-job effect");
  return effect;
};

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const row = (state: jobsReducer.State) => {
  const job = state.jobs[JOB_ID];
  return job ? jobUploadEntry(job) : null;
};

describe("an enqueue whose answer never came", () => {
  it("does not fail the row (which would invite a second post): it asks again, by the same id, after a wait", () => {
    const tester = newTester().send(requestPost());
    const sent = firstEnqueue(tester);
    expect(sent).toMatchObject({ checks: 0, afterMs: 0 });

    tester.resetExec().send({
      type: "enqueue-unanswered",
      enqueue: sent,
      message: "Failed to fetch",
    });

    expect(row(tester.getState())).toMatchObject({
      status: "retrying",
      errorMessage: ENQUEUE_UNCONFIRMED_MESSAGE,
    });
    // No failure toast, nothing told it failed: it may well be queued.
    expect(tester.getEffects()).toEqual([
      { ...sent, checks: 1, afterMs: 1_000 },
    ]);
  });

  it("waits longer each time it goes unanswered, up to half a minute", () => {
    const tester = newTester().send(requestPost());
    let sent = firstEnqueue(tester);
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      tester.resetExec().send({
        type: "enqueue-unanswered",
        enqueue: sent,
        message: "Failed to fetch",
      });
      sent = firstEnqueue(tester);
      waits.push(sent.afterMs);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("is settled by the stream: the Job is there, so the row is queued and what waited on it goes", () => {
    const CHILD_ID = "6b0c1f5e-0000-4000-8000-0000000000c1";
    const tester = newTester()
      .send(requestPost())
      .send(requestPost(CHILD_ID, JOB_ID));
    const sent = firstEnqueue(tester);
    tester
      .send({ type: "enqueue-unanswered", enqueue: sent, message: "offline" })
      .send(toJobsAction({ job: postJob, event: queuedEvent })!)
      .resetExec()
      .send({ type: "enqueue-unanswered", enqueue: sent, message: "offline" });

    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      errorMessage: null,
    });
    // It asks no more, and the held post goes out.
    expect(tester.getEffects()).toEqual([
      expect.objectContaining({ type: "enqueue-job", id: CHILD_ID }),
    ]);
  });

  it("an answer that refuses it still fails the row", () => {
    const tester = newTester().send(requestPost());
    tester.resetExec().send({
      type: "enqueue-failed",
      id: JOB_ID,
      message: "Could not queue it: no such job kind",
    });
    expect(row(tester.getState())).toMatchObject({ status: "error" });
  });
});

describe("an enqueue the server answers with another Job", () => {
  const LIVE_ID = "6b0c1f5e-0000-4000-8000-0000000000aa";

  it("joins that live Job: the request is dropped, and whoever asked is told", () => {
    const tester = newTester().send(requestPost());
    tester
      .resetExec()
      .send({ type: "enqueue-succeeded", id: JOB_ID, answeredBy: LIVE_ID });

    expect(tester.getState().jobs[JOB_ID]).toBeUndefined();
    expect(tester.getEffects()).toEqual([
      { type: "report-job-joined", id: JOB_ID, jobId: LIVE_ID },
    ]);
  });

  it("an answer naming the Job asked for is no join", () => {
    const tester = newTester().send(requestPost());
    tester
      .resetExec()
      .send({ type: "enqueue-succeeded", id: JOB_ID, answeredBy: JOB_ID });

    expect(tester.getState().jobs[JOB_ID]).toMatchObject({ enqueued: true });
    expect(tester.getEffects()).toEqual([]);
  });
});
