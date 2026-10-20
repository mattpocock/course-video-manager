import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";
import { clockOffsetOf } from "./jobs-timing";
import type { WireJob, WireJobEvent } from "./job-wire";
import { historyLookupOf, type HistoryData } from "./job-stage-history";
import { estimateUploads } from "@/features/upload-manager/upload-eta-schedule";

/**
 * A Job row's timings come from its Job Events, stamped with each event's
 * `at` (the database's clock), live or replayed from a snapshot.
 */

const T0 = Date.parse("2026-10-09T12:00:00.000Z");

const exportJob: WireJob = {
  id: "6b0c1f5e-0000-4000-8000-0000000000e1",
  kind: "export",
  title: "Intro",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const publishJob: WireJob = {
  id: "6b0c1f5e-0000-4000-8000-0000000000p1",
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

/** Events as the live stream delivers them, heard `skewMs` after their `at`. */
const live = (events: WireJobEvent[], job: WireJob, skewMs = 0) =>
  events.map((e) => {
    const action = toJobsAction({ job, event: e }, Date.parse(e.at) + skewMs);
    if (!action) throw new Error(`no action for ${e.type}`);
    return action;
  });

const snapshotOf = (
  job: WireJob,
  events: WireJobEvent[]
): jobsReducer.Action => ({
  type: "job-snapshot-received",
  snapshot: { cursor: events.at(-1)?.id ?? 0, jobs: [{ job, events }] },
});

const runLive = (actions: jobsReducer.Action[]) =>
  actions
    .reduce(
      (tester, action) => tester.send(action),
      new ReducerTester(jobsReducer, createInitialJobsState())
    )
    .getState();

const exportEvents = () => [
  event(exportJob, 0, "queued"),
  event(exportJob, 0, "started", { attempt: 1 }),
  event(exportJob, 1_000, "stage", { stage: "concatenating-clips" }),
  event(exportJob, 5_000, "progress", {
    stage: "concatenating-clips",
    percent: 25,
  }),
  event(exportJob, 9_000, "progress", {
    stage: "concatenating-clips",
    percent: 50,
  }),
];

describe("a Job row's timings", () => {
  it("are stamped with each Job Event's `at`: the stage start and the bar's samples", () => {
    const state = runLive(live(exportEvents(), exportJob, 700));
    const timing = state.timings[exportJob.id];
    expect(timing).toMatchObject({
      stage: "concatenating-clips",
      stageStartedAt: T0 + 1_000,
      samples: [
        { at: T0 + 1_000, progress: 0 },
        { at: T0 + 5_000, progress: 20 },
        { at: T0 + 9_000, progress: 40 },
      ],
      completed: [],
      endedAt: null,
    });
  });

  it("record a stage once it moves on, with the time between the events", () => {
    const events = [
      ...exportEvents(),
      event(exportJob, 21_000, "stage", { stage: "normalizing-audio" }),
    ];
    const state = runLive(live(events, exportJob));
    expect(state.timings[exportJob.id]?.completed).toEqual([
      { key: "export:concatenating-clips", durationMs: 20_000, units: null },
    ]);
  });

  it("are the same when a reopened tab replays the events from a snapshot", () => {
    const events = [
      ...exportEvents(),
      event(exportJob, 21_000, "stage", { stage: "normalizing-audio" }),
    ];
    const heardLive = runLive(live(events, exportJob));
    const replayed = runLive([snapshotOf(exportJob, events)]);
    expect(replayed.timings[exportJob.id]).toEqual(
      heardLive.timings[exportJob.id]
    );
  });

  it("time a Publish's parent row and each of its Videos", () => {
    const events = [
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
        uploadedBytes: 10,
        totalBytes: 100,
      }),
    ];
    const state = runLive(live(events, publishJob));
    expect(state.timings[publishJob.id]).toMatchObject({
      stage: "work",
      stageStartedAt: T0 + 2_000,
      completed: [
        // A started Publish's row reads "validating" until it says otherwise.
        { key: "publish:validating", durationMs: 1_000 },
        { key: "publish:cloning", durationMs: 1_000 },
      ],
    });
    expect(state.timings[`${publishJob.id}/video-a`]).toMatchObject({
      stage: "concatenating-clips",
      stageStartedAt: T0 + 3_000,
      needsExport: true,
    });
    expect(state.timings[`${publishJob.id}/video-b`]).toMatchObject({
      stage: "uploading",
      stageStartedAt: T0 + 4_000,
      needsExport: false,
    });
  });

  it("are dropped for a Video a Batch export hands on to its own Job", () => {
    const batchJob: WireJob = {
      ...exportJob,
      id: "batch-1",
      kind: "batch-export",
    };
    const events = [
      event(batchJob, 0, "started", { attempt: 1 }),
      event(batchJob, 0, "videos", {
        videos: [{ id: "video-a", title: "Intro" }],
      }),
      event(batchJob, 1_000, "video-stage", {
        videoId: "video-a",
        stage: "concatenating-clips",
      }),
    ];
    const before = runLive(live(events, batchJob));
    expect(before.timings["batch-1/video-a"]).toBeDefined();
    const after = runLive(
      live(
        [
          ...events,
          event(batchJob, 2_000, "video-handed-off", { videoId: "video-a" }),
        ],
        batchJob
      )
    );
    expect(after.timings["batch-1/video-a"]).toBeUndefined();
  });
});

describe("the tab's clock offset", () => {
  it("is the smallest gap between a live event's arrival and its `at`", () => {
    const actions = live(exportEvents(), exportJob, 5_000);
    // One event heard late (a replay after a reconnect) does not move it.
    const late = live(
      [
        event(exportJob, 9_500, "progress", {
          stage: "concatenating-clips",
          percent: 51,
        }),
      ],
      exportJob,
      60_000
    );
    expect(clockOffsetOf(runLive([...actions, ...late]))).toBe(5_000);
  });

  it("is 0 before any live event: a snapshot's replay says nothing about it", () => {
    expect(
      clockOffsetOf(runLive([snapshotOf(exportJob, exportEvents())]))
    ).toBe(0);
  });

  it("keeps the elapsed time right when this tab's clock runs 5s ahead", () => {
    const history: HistoryData = {
      "export:concatenating-clips": [{ durationMs: 60_000, units: null }],
      "export:normalizing-audio": [{ durationMs: 10_000, units: null }],
    };
    const lookup = historyLookupOf(history);
    const etaAt = (skewMs: number) => {
      const state = runLive(
        live(exportEvents().slice(0, 3), exportJob, skewMs)
      );
      const rows = Object.fromEntries(
        jobUploadEntries(state.jobs[exportJob.id]!).map((r) => [r.uploadId, r])
      );
      // 2s after the stage started, by the database's clock.
      const tabNow = T0 + 3_000 + skewMs;
      return estimateUploads(rows, {
        timings: state.timings,
        history: lookup,
        now: tabNow - clockOffsetOf(state),
      })[exportJob.id];
    };
    const expected = { kind: "remaining", ms: 58_000 + 10_000, scope: "job" };
    expect(etaAt(0)).toEqual(expected);
    expect(etaAt(5_000)).toEqual(expected);
  });
});

describe("a Publish Job's estimate", () => {
  it("gives a number for the parent and both Videos, from history", () => {
    const runs = (durationMs: number) =>
      Array.from({ length: 3 }, () => ({ durationMs, units: null }));
    const lookup = historyLookupOf({
      "export:concatenating-clips": runs(50_000),
      "export:normalizing-audio": runs(10_000),
      "export:uploading": runs(20_000),
      "publish:finalizing": runs(30_000),
    });
    const events = [
      event(publishJob, 0, "queued"),
      event(publishJob, 0, "started", { attempt: 1 }),
      event(publishJob, 0, "stage", { stage: "cloning" }),
      event(publishJob, 0, "videos", {
        videos: [
          { id: "video-a", title: "S1/L1/Intro" },
          { id: "video-b", title: "S1/L2/Generics" },
        ],
      }),
      event(publishJob, 0, "stage", { stage: "exporting" }),
      event(publishJob, 0, "video-stage", {
        videoId: "video-a",
        stage: "concatenating-clips",
      }),
      event(publishJob, 0, "video-stage", {
        videoId: "video-b",
        stage: "concatenating-clips",
      }),
    ];
    const state = runLive(live(events, publishJob));
    const rows = Object.fromEntries(
      jobUploadEntries(state.jobs[publishJob.id]!).map((r) => [r.uploadId, r])
    );
    const etas = estimateUploads(rows, {
      timings: state.timings,
      history: lookup,
      now: T0,
    });
    // Each Video: a 60s encode, then a 20s upload. The Publish: then a 30s commit.
    expect(etas[`${publishJob.id}/video-a`]).toEqual({
      kind: "remaining",
      ms: 80_000,
      scope: "job",
    });
    expect(etas[`${publishJob.id}/video-b`]).toEqual({
      kind: "remaining",
      ms: 80_000,
      scope: "job",
    });
    expect(etas[publishJob.id]).toEqual({
      kind: "remaining",
      ms: 110_000,
      scope: "job",
    });
  });
});

describe("a Job this tab joins part-way", () => {
  // The stream's catch-up re-sends the last minute of events when the first
  // tab subscribes, a dismissed Job's included: it is not in the snapshot,
  // and every one of its events is older than the snapshot's cursor.
  const caughtUp = ({ from }: { from: "queued" | "mid-stage" }) => {
    const all = [
      ...exportEvents(),
      event(exportJob, 21_000, "stage", { stage: "normalizing-audio" }),
      event(exportJob, 26_000, "succeeded", { attempt: 1 }),
      event(exportJob, 31_000, "dismissed"),
    ];
    const events = from === "queued" ? all : all.slice(3);
    return runLive([
      {
        type: "job-snapshot-received",
        snapshot: { cursor: all.at(-1)!.id, jobs: [] },
      },
      ...live(events, exportJob, 60_000),
    ]);
  };

  for (const from of ["queued", "mid-stage"] as const) {
    it(`does not move the clock offset with its late deliveries, caught up from ${from}`, () => {
      expect(clockOffsetOf(caughtUp({ from }))).toBe(0);
    });
  }

  it("is timed like any other when its `queued` event is newer than the snapshot", () => {
    const events = [
      ...exportEvents(),
      event(exportJob, 21_000, "stage", { stage: "normalizing-audio" }),
    ];
    const state = runLive(live(events, exportJob, 200));
    expect(state.timings[exportJob.id]?.completed).toEqual([
      { key: "export:concatenating-clips", durationMs: 20_000, units: null },
    ]);
    expect(clockOffsetOf(state)).toBe(200);
  });
});
