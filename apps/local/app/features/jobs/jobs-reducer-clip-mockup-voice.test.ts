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

const voiceJob: WireJob = {
  id: JOB_ID,
  kind: "clip-mockup-voice",
  title: "Voice 3 Clip Mockups",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let nextEventId = 100;
const voice = (type: string, data: Record<string, unknown> = {}) => {
  const action = toJobsAction({
    job: voiceJob,
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

const toasts = (tester: ReducerTester<any, any, any>) =>
  tester
    .getEffects()
    .filter(
      (e: { type: string }) =>
        e.type === "show-job-succeeded-toast" ||
        e.type === "show-job-failed-toast"
    );

// A Clip Mockup's voice is made by the Sidecar after `cvm clip-mockup add`
// returns: one Job per batch, often while nobody watches. Like a Clip
// transcription, it is shown on what it voices, not in the Upload Manager.
describe("a Clip Mockup voice Job", () => {
  it("draws no Upload Manager row, running or settled", () => {
    const tester = new ReducerTester(
      jobsReducer,
      createInitialJobsState()
    ).send(voice("started", { attempt: 1 }));
    const rowsOf = () => jobUploadEntries(tester.getState().jobs[JOB_ID]!);
    expect(rowsOf()).toEqual([]);
    tester.send(voice("succeeded"));
    expect(rowsOf()).toEqual([]);
  });

  it("shows no toast when it succeeds", () => {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState())
      .send(voice("started", { attempt: 1 }))
      .send(voice("succeeded"));
    expect(toasts(tester)).toEqual([]);
  });

  it("shows no toast when it fails for good either: the Clip Mockup and the Jobs list show it", () => {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState())
      .send(voice("started", { attempt: 3 }))
      .send(voice("failed", { error: { message: "the GPU would not load" } }));
    expect(toasts(tester)).toEqual([]);
  });
});
