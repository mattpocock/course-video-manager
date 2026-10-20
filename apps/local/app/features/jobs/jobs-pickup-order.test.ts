import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { createInitialJobsState, jobsReducer } from "./jobs-reducer";
import { visibleJobRows } from "./jobs-selectors";
import { rowsInPickupOrder } from "./jobs-pickup-order";
import type { WireJob, WireJobEvent } from "./job-wire";

const T0 = Date.parse("2026-10-20T12:00:00.000Z");

const exportJob = (title: string, createdAtMs: number): WireJob => ({
  id: `job-${title}`,
  kind: "export",
  title,
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: `video-${title}`,
  createdAt: new Date(T0 + createdAtMs).toISOString(),
});

let nextEventId = 1;
const event = (job: WireJob, atMs: number, type: string): WireJobEvent => ({
  id: nextEventId++,
  jobId: job.id,
  type,
  data: type === "started" ? { attempt: 1 } : {},
  at: new Date(T0 + atMs).toISOString(),
});

describe("rowsInPickupOrder", () => {
  it("puts finished rows first by when they finished, then running, then waiting, each in the Sidecar's claim order", () => {
    const waitingLate = exportJob("waiting-late", 5_000);
    const waitingEarly = exportJob("waiting-early", 4_000);
    const running = exportJob("running", 3_000);
    const failedLate = exportJob("failed-late", 1_000);
    const doneEarly = exportJob("done-early", 2_000);

    // The snapshot meets them in an order unrelated to either.
    const state = new ReducerTester(jobsReducer, createInitialJobsState())
      .send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 100,
          jobs: [
            { job: waitingLate, events: [event(waitingLate, 5_000, "queued")] },
            {
              job: running,
              events: [
                event(running, 3_000, "queued"),
                event(running, 6_000, "started"),
              ],
            },
            {
              job: failedLate,
              events: [
                event(failedLate, 1_000, "queued"),
                event(failedLate, 1_000, "started"),
                event(failedLate, 9_000, "failed"),
              ],
            },
            {
              job: waitingEarly,
              events: [event(waitingEarly, 4_000, "queued")],
            },
            {
              job: doneEarly,
              events: [
                event(doneEarly, 2_000, "queued"),
                event(doneEarly, 2_000, "started"),
                event(doneEarly, 7_000, "succeeded"),
              ],
            },
          ],
        },
      })
      .getState();

    expect(
      rowsInPickupOrder(state, visibleJobRows(state)).map((row) => row.title)
    ).toEqual([
      "done-early",
      "failed-late",
      "running",
      "waiting-early",
      "waiting-late",
    ]);
  });
});
