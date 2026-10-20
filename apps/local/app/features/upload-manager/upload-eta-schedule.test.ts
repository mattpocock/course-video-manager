import { describe, expect, it } from "vitest";
import {
  historyLookupOf,
  type HistoryData,
} from "@/features/jobs/job-stage-history";
import { allDoneEta, estimateUploads } from "./upload-eta-schedule";
import type { TimedRows } from "./upload-timing";
import {
  autofillStage,
  exportStage,
  publishStage,
  replay,
  start,
  type RowStep,
} from "./upload-timing-test-setup";

type Step = RowStep;

const run = (steps: Step[]) => replay(steps);

const runs = (durationMs: number) =>
  Array.from({ length: 3 }, () => ({ durationMs, units: null }));

const estimate = (state: TimedRows, now: number, past: HistoryData) =>
  estimateUploads(state.uploads, {
    timings: state.timings,
    history: historyLookupOf(past),
    now,
  });

const msOf = (eta: unknown) =>
  (eta as { kind: string; ms?: number }).kind === "remaining"
    ? (eta as { ms: number }).ms
    : eta;

/** A Publish fanned out into `count` Videos, each with an encode to do. */
const publishOf = (count: number, { exported = false } = {}): Step[] => {
  const steps: Step[] = [[0, start("p", "publish")]];
  for (let i = 1; i <= count; i++) {
    steps.push([
      0,
      start(`v${i}`, "export", { isBatchEntry: true, parentUploadId: "p" }),
    ]);
  }
  steps.push([0, publishStage("p", "uploading")]);
  if (!exported) {
    for (let i = 1; i <= count; i++) {
      steps.push([0, exportStage(`v${i}`, "queued")]);
    }
  }
  return steps;
};

// An encode is 60s (50 + 10), an upload 20s, the commit 30s.
const publishHistory: HistoryData = {
  "export:concatenating-clips": runs(50_000),
  "export:normalizing-audio": runs(10_000),
  "export:uploading": runs(20_000),
  "publish:finalizing": runs(30_000),
};

describe("a Publish's estimate", () => {
  it("replays its encodes six at a time", () => {
    // 8 Videos: encodes finish at 60s (×6) and 120s (×2). Eight upload slots
    // never make one wait on another, so each upload follows its own encode:
    // v1–v6 upload 60→80s, v7–v8 120→140s.
    const etas = estimate(run(publishOf(8)), 0, publishHistory);
    expect(msOf(etas.v1)).toBe(80_000);
    expect(msOf(etas.v6)).toBe(80_000);
    expect(msOf(etas.v8)).toBe(140_000);
    expect(etas.p).toEqual({
      kind: "remaining",
      ms: 140_000 + 30_000,
      scope: "job",
    });
  });

  it("replays its uploads eight at a time", () => {
    // 10 Videos already on disk: v1–v8 upload 0→20s, v9–v10 20→40s.
    const etas = estimate(
      run(publishOf(10, { exported: true })),
      0,
      publishHistory
    );
    expect(msOf(etas.v8)).toBe(20_000);
    expect(msOf(etas.v9)).toBe(40_000);
  });

  it("does not wait on an encode for a Video already on disk", () => {
    const etas = estimate(
      run(publishOf(4, { exported: true })),
      0,
      publishHistory
    );
    expect(msOf(etas.v4)).toBe(20_000);
  });

  it("credits work a child has already done", () => {
    const state = run([
      ...publishOf(1),
      [0, exportStage("v1", "concatenating-clips")],
      [40_000, exportStage("v1", "normalizing-audio")],
    ]);
    // 10s of normalizing, then a 20s upload.
    expect(msOf(estimate(state, 40_000, publishHistory).v1)).toBe(30_000);
  });

  it("says how long its children's part takes when the commit has no history", () => {
    const { "publish:finalizing": _, ...noCommit } = publishHistory;
    expect(estimate(run(publishOf(2)), 0, noCommit).p).toEqual({
      kind: "remaining",
      ms: 80_000,
      scope: "stage",
    });
  });

  it("is estimating while its Videos have no history and no signal", () => {
    expect(estimate(run(publishOf(2)), 0, {}).p).toEqual({
      kind: "estimating",
    });
  });

  it("estimates only its current stage before its Videos are known", () => {
    const state = run([
      [0, start("p", "publish")],
      [0, publishStage("p", "validating")],
    ]);
    expect(
      estimate(state, 1_000, { "publish:validating": runs(5_000) }).p
    ).toEqual({
      kind: "remaining",
      ms: 4_000,
      scope: "stage",
    });
  });
});

describe("an Autofill's estimate", () => {
  const autofillOf = (count: number): Step[] => [
    [0, start("a", "autofill")],
    [0, autofillStage("a", "writing")],
    ...Array.from({ length: count }, (_, i): Step => [
      0,
      start(`w${i + 1}`, "autofill", { parentUploadId: "a" }),
    ]),
  ];

  it("runs its Videos six at a time, counting those not started yet", () => {
    // 13 Videos of 10s: three rounds.
    const etas = estimate(run(autofillOf(13)), 0, {
      "autofill-video:writing": runs(10_000),
    });
    expect(etas.a).toEqual({ kind: "remaining", ms: 30_000, scope: "job" });
    expect(msOf(etas.w13)).toBe(30_000);
  });
});

describe("Export All", () => {
  it("queues its Videos behind the six-way encode pool", () => {
    const steps: Step[] = Array.from({ length: 7 }, (_, i): Step => [
      0,
      start(`e${i + 1}`, "export", { isBatchEntry: true }),
    ]);
    const state = run(steps);
    const etas = estimate(state, 0, publishHistory);
    expect(msOf(etas.e1)).toBe(60_000);
    expect(msOf(etas.e7)).toBe(120_000);
    expect(allDoneEta(state.uploads, etas)).toBe(120_000);
  });
});

describe("allDoneEta", () => {
  it("is unknown while any top-level job has no whole-job estimate", () => {
    const state = run([
      [0, start("e1", "export")],
      [0, start("r1", "render-vertical")],
    ]);
    expect(allDoneEta(state.uploads, estimate(state, 0, publishHistory))).toBe(
      null
    );
  });
});
