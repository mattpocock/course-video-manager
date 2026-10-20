import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import {
  MAX_RECORDS_PER_STAGE,
  historyLookupOf,
  stageHistoryFrom,
  statsFrom,
  type StageRecord,
} from "./job-stage-history";
import type { JobStageHistoryMessage, WireJob, WireJobEvent } from "./job-wire";

/**
 * The ETA's stage history, folded from the Job Events of finished Jobs
 * (`GET /api/jobs/stage-history`) the way the live stream is folded.
 */

const T0 = Date.parse("2026-10-09T12:00:00.000Z");

const exportJob: WireJob = {
  id: "export-1",
  kind: "export",
  title: "Intro",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const publishJob: WireJob = {
  id: "publish-1",
  kind: "publish",
  title: "Generics",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "course",
  subjectId: "course-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let nextEventId = 1;
const event = (
  job: WireJob,
  atMs: number,
  type: string,
  data: Record<string, unknown> = {}
): WireJobEvent => ({
  id: nextEventId++,
  jobId: job.id,
  type,
  data,
  at: new Date(T0 + atMs).toISOString(),
});

const exportRun = (job: WireJob, offsetMs: number, encodeMs: number) => [
  event(job, offsetMs, "queued"),
  event(job, offsetMs + 2_000, "started", { attempt: 1 }),
  event(job, offsetMs + 2_000, "stage", { stage: "concatenating-clips" }),
  event(job, offsetMs + 4_000, "progress", {
    stage: "concatenating-clips",
    percent: 40,
  }),
  event(job, offsetMs + 2_000 + encodeMs, "stage", {
    stage: "normalizing-audio",
  }),
  event(job, offsetMs + 2_000 + encodeMs + 1_000, "progress", {
    stage: "normalizing-audio",
    percent: 50,
  }),
  event(job, offsetMs + 2_000 + encodeMs + 5_000, "succeeded"),
];

const publishRun = () => [
  event(publishJob, 0, "queued"),
  event(publishJob, 0, "started", { attempt: 1 }),
  event(publishJob, 500, "stage", { stage: "validating" }),
  event(publishJob, 1_000, "stage", { stage: "cloning" }),
  event(publishJob, 2_000, "videos", {
    videos: [
      { id: "video-a", title: "S1/L1/Intro" },
      { id: "video-b", title: "S1/L2/Generics" },
    ],
  }),
  event(publishJob, 2_000, "stage", { stage: "exporting" }),
  event(publishJob, 3_000, "video-stage", {
    videoId: "video-a",
    stage: "concatenating-clips",
  }),
  event(publishJob, 3_000, "video-upload-queued", { videoId: "video-b" }),
  event(publishJob, 4_000, "video-upload-progress", {
    videoId: "video-b",
    uploadedBytes: 0,
    totalBytes: 1_000,
  }),
  event(publishJob, 9_000, "video-upload-progress", {
    videoId: "video-b",
    uploadedBytes: 500,
    totalBytes: 1_000,
  }),
  event(publishJob, 14_000, "video-succeeded", { videoId: "video-b" }),
  event(publishJob, 23_000, "video-upload-queued", { videoId: "video-a" }),
  event(publishJob, 24_000, "video-upload-progress", {
    videoId: "video-a",
    uploadedBytes: 0,
    totalBytes: 4_000,
  }),
  event(publishJob, 44_000, "video-succeeded", { videoId: "video-a" }),
  event(publishJob, 45_000, "stage", { stage: "complete" }),
  event(publishJob, 50_000, "succeeded"),
];

/** What the old localStorage store recorded: every stage a live tab saw finish. */
const recordedLive = (runs: { job: WireJob; events: WireJobEvent[] }[]) => {
  const records: Record<string, StageRecord[]> = {};
  for (const { job, events } of runs) {
    const tester = new ReducerTester(jobsReducer, createInitialJobsState());
    const seen = new Set<object>();
    for (const e of events) {
      const action = toJobsAction({ job, event: e }, Date.parse(e.at));
      if (!action) continue;
      tester.send(action);
      for (const timing of Object.values(tester.getState().timings)) {
        for (const stage of timing.completed) {
          if (seen.has(stage)) continue;
          seen.add(stage);
          (records[stage.key] ??= []).push({
            durationMs: stage.durationMs,
            units: stage.units,
          });
        }
      }
    }
  }
  return records;
};

/** As `listJobStageHistory` sends them: repeated progress events dropped. */
const withoutRepeatedProgress = (events: WireJobEvent[]) => {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (
      !["progress", "video-progress", "video-upload-progress"].includes(e.type)
    )
      return true;
    const key = `${e.type}|${e.data.videoId ?? ""}|${e.data.stage ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

describe("stageHistoryFrom", () => {
  it("gives the same stats the localStorage store kept for the same export and Publish", () => {
    const runs = [
      { job: exportJob, events: exportRun(exportJob, 0, 20_000) },
      { job: publishJob, events: publishRun() },
    ];
    const live = recordedLive(runs);
    const message: JobStageHistoryMessage = {
      jobs: runs.map(({ job, events }) => ({
        job,
        events: withoutRepeatedProgress(events),
      })),
    };
    const fromEvents = stageHistoryFrom(message);

    expect(Object.keys(fromEvents).sort()).toEqual(Object.keys(live).sort());
    const lookup = historyLookupOf(fromEvents);
    for (const [key, records] of Object.entries(live)) {
      expect(lookup(key)).toEqual(statsFrom(records));
    }
    // The ones the Publish ETA leans on, by name.
    expect(lookup("export:concatenating-clips")!.count).toBe(2);
    expect(lookup("export:uploading")).toEqual({
      typicalMs: 15_000,
      // 10s for 1,000 bytes, 20s for 4,000.
      msPerUnit: 7.5,
      count: 2,
    });
    expect(lookup("publish:cloning")).toMatchObject({ typicalMs: 1_000 });
    // From the last Video settling to the Publish succeeding.
    expect(lookup("publish:finalizing")).toMatchObject({ typicalMs: 6_000 });
  });

  it("keeps the newest runs of each stage, oldest first", () => {
    const runs = Array.from({ length: MAX_RECORDS_PER_STAGE + 5 }, (_, i) => {
      const job = { ...exportJob, id: `export-${i}` };
      return { job, events: exportRun(job, i * 100_000, (i + 1) * 1_000) };
    });
    const data = stageHistoryFrom({ jobs: runs });
    const encodes = data["export:concatenating-clips"]!;
    expect(encodes).toHaveLength(MAX_RECORDS_PER_STAGE);
    expect(encodes.at(-1)!.durationMs).toBe(25_000);
    expect(encodes[0]!.durationMs).toBe(6_000);
  });

  it("leaves out a stage cut short by a requeue", () => {
    const events = [
      event(exportJob, 0, "queued"),
      event(exportJob, 1_000, "started", { attempt: 1 }),
      event(exportJob, 1_000, "stage", { stage: "concatenating-clips" }),
      // The sidecar stops 2s in: back to the queue, same attempt.
      event(exportJob, 3_000, "requeued", { attempt: 1 }),
      // Restarted ten minutes later, where the stage really takes 60s.
      event(exportJob, 600_000, "started", { attempt: 1 }),
      event(exportJob, 600_000, "stage", { stage: "concatenating-clips" }),
      event(exportJob, 660_000, "stage", { stage: "normalizing-audio" }),
      event(exportJob, 665_000, "succeeded"),
    ];
    const data = stageHistoryFrom({ jobs: [{ job: exportJob, events }] });
    expect(data["export:concatenating-clips"]).toEqual([
      { durationMs: 60_000, units: null },
    ]);
  });

  it("is empty with no Jobs", () => {
    expect(stageHistoryFrom({ jobs: [] })).toEqual({});
  });
});

describe("stage stats", () => {
  it("summarise a stage by its median, so one slow run does not skew it", () => {
    expect(
      statsFrom([
        { durationMs: 10_000, units: null },
        { durationMs: 12_000, units: null },
        { durationMs: 600_000, units: null },
      ])
    ).toEqual({ typicalMs: 12_000, msPerUnit: null, count: 3 });
  });

  it("derive a per-unit rate from the records that carry a size", () => {
    expect(
      statsFrom([
        { durationMs: 10_000, units: 100 },
        { durationMs: 40_000, units: 200 },
        { durationMs: 99_000, units: null },
      ])!.msPerUnit
    ).toBe(150);
  });

  it("know nothing about a stage never seen", () => {
    expect(historyLookupOf({})("render-vertical:compositing")).toBe(null);
  });
});

describe("the jobs reducer's stage history", () => {
  const newTester = () =>
    new ReducerTester(jobsReducer, createInitialJobsState());
  const snapshot = (cursor: number): jobsReducer.Action => ({
    type: "job-snapshot-received",
    snapshot: { cursor, jobs: [] },
  });
  const loaded = (requestId: number): jobsReducer.Action => ({
    type: "stage-history-loaded",
    requestId,
    history: {
      jobs: [{ job: exportJob, events: exportRun(exportJob, 0, 20_000) }],
    },
  });

  it("is loaded with each snapshot, and an older answer is ignored", () => {
    const tester = newTester().send(snapshot(0)).send(snapshot(0));
    expect(tester.getEffects()).toEqual([
      { type: "load-stage-history", requestId: 1 },
      { type: "load-stage-history", requestId: 2 },
    ]);
    tester.send(loaded(1));
    expect(tester.getState().stageHistory).toEqual({});
    tester.send(loaded(2));
    expect(
      tester.getState().stageHistory["export:concatenating-clips"]
    ).toEqual([{ durationMs: 20_000, units: null }]);
  });

  it("is loaded again when a Job succeeds live, never for one the catch-up replays", () => {
    const job = { ...exportJob, id: "export-live" };
    const replayed = exportRun({ ...exportJob, id: "export-old" }, 0, 1_000);
    const tester = newTester().send(snapshot(replayed.at(-1)!.id));
    for (const e of replayed) {
      tester.send(
        toJobsAction({ job: { ...exportJob, id: "export-old" }, event: e })!
      );
    }
    for (const e of exportRun(job, 0, 1_000)) {
      tester.send(toJobsAction({ job, event: e })!);
    }
    expect(
      tester.getEffects().filter((e) => e.type === "load-stage-history")
    ).toEqual([
      { type: "load-stage-history", requestId: 1 },
      { type: "load-stage-history", requestId: 2 },
    ]);
  });
});
