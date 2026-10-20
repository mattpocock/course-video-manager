import { describe, expect, it } from "vitest";
import { createJobEventHub, snapshotJobEvents } from "./job-event-hub";
import type { JobSnapshotMessage, WireJob } from "./job-wire";

const job = (id: string): WireJob => ({
  id,
  kind: "transcribe-clips",
  title: "Transcribe 1 Clip",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const event = (jobId: string, id: number, type = "started") => ({
  id,
  jobId,
  type,
  data: {},
  at: "2026-10-09T12:00:00.000Z",
});

const message = (id: number) => ({ job: job("a"), event: event("a", id) });

describe("snapshotJobEvents", () => {
  it("lists a snapshot's events oldest first, across Jobs", () => {
    const snapshot: JobSnapshotMessage = {
      cursor: 9,
      jobs: [
        { job: job("b"), events: [event("b", 5)] },
        {
          job: job("a"),
          events: [event("a", 2), event("a", 7, "succeeded")],
        },
      ],
    };
    expect(
      snapshotJobEvents(snapshot).map((m) => [m.job.id, m.event.id])
    ).toEqual([
      ["a", 2],
      ["b", 5],
      ["a", 7],
    ]);
  });
});

describe("createJobEventHub", () => {
  it("tells every listener until it unsubscribes", () => {
    const hub = createJobEventHub();
    const heard: number[] = [];
    const unsubscribe = hub.subscribe((m) => heard.push(m.event.id));
    hub.publish(message(1));
    unsubscribe();
    hub.publish(message(2));
    expect(heard).toEqual([1]);
  });

  it("tells a late subscriber the recent events first, oldest first", () => {
    const hub = createJobEventHub(2);
    hub.publish(message(1));
    hub.publish(message(2));
    hub.publish(message(3));
    const heard: number[] = [];
    hub.subscribe((m) => heard.push(m.event.id));
    hub.publish(message(4));
    expect(heard).toEqual([2, 3, 4]);
  });
});
