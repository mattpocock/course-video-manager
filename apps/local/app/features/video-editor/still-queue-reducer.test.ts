import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialStillQueueState,
  isStillAdmitted,
  STILLS_IN_FLIGHT,
  stillQueueReducer,
} from "./still-queue-reducer";

const tickets = Array.from({ length: 40 }, (_, i) => `clip-${i}`);

const admitted = (state: stillQueueReducer.State) =>
  tickets.filter((t) => isStillAdmitted(state, t));

describe("the still queue", () => {
  it("never has more than two stills in flight, so the rest of the browser's connections stay free for the video (#2323)", () => {
    const tester = new ReducerTester(
      stillQueueReducer,
      createInitialStillQueueState()
    );
    for (const ticket of tickets) {
      tester.send({ type: "still-mounted", ticket });
    }
    expect(STILLS_IN_FLIGHT).toBe(2);
    expect(admitted(tester.getState())).toEqual(["clip-0", "clip-1"]);

    // A loaded still keeps its src and hands its slot to the next in line;
    // a failed one does the same.
    tester.send({ type: "still-settled", ticket: "clip-0" });
    tester.send({ type: "still-settled", ticket: "clip-1" });
    expect(tester.getState().loading).toEqual(["clip-2", "clip-3"]);
    expect(admitted(tester.getState())).toEqual([
      "clip-0",
      "clip-1",
      "clip-2",
      "clip-3",
    ]);

    // A still that goes away mid-load frees its slot; one that goes away
    // while waiting never asks at all.
    tester.send({ type: "still-unmounted", ticket: "clip-2" });
    tester.send({ type: "still-unmounted", ticket: "clip-5" });
    expect(tester.getState().loading).toEqual(["clip-3", "clip-4"]);
    tester.send({ type: "still-settled", ticket: "clip-3" });
    expect(tester.getState().loading).toEqual(["clip-4", "clip-6"]);
  });
});
