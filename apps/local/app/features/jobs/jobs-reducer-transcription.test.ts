import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";
import type { WireJob } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000c7";

const transcriptionJob: WireJob = {
  id: JOB_ID,
  kind: "transcribe-clips",
  title: "Transcribe 1 Clip",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let nextEventId = 100;
const transcription = (type: string, data: Record<string, unknown> = {}) => {
  const action = toJobsAction({
    job: transcriptionJob,
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

// Clip transcription was never an Upload Manager job: the editor shows it on
// the Clip itself. Its Job must not appear as a row in the Global Upload
// Progress.
describe("a Clip transcription Job", () => {
  it("draws no Upload Manager row, running or settled", () => {
    const tester = new ReducerTester(
      jobsReducer,
      createInitialJobsState()
    ).send(transcription("started", { attempt: 1 }));
    const rowsOf = () => {
      const job = tester.getState().jobs[JOB_ID];
      expect(job).toBeDefined();
      return jobUploadEntries(job!);
    };
    expect(rowsOf()).toEqual([]);

    tester.send(transcription("succeeded"));
    expect(rowsOf()).toEqual([]);
  });
});

// The Clip shows its own state; a Job per recording would toast on every take.
describe("a Clip transcription Job settling", () => {
  it.each(["succeeded", "failed", "interrupted"])(
    "shows no toast when it %s",
    (outcome) => {
      const tester = new ReducerTester(jobsReducer, createInitialJobsState())
        .send(transcription("started", { attempt: 1 }))
        .send(transcription(outcome, { error: { message: "boom" } }));
      expect(
        tester
          .getEffects()
          .filter(
            (e) =>
              e.type === "show-job-succeeded-toast" ||
              e.type === "show-job-failed-toast"
          )
      ).toEqual([]);
    }
  );
});
