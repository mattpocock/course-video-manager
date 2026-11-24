import { describe, expect, expectTypeOf, it } from "vitest";
import { initialTransition, isUnhandled, transition } from "xstate";
import { recorderSessionMachine } from "./recorder-session-machine";

const started = {
  type: "recording-started",
  recordingSessionId: "s1",
  silenceLength: "long",
} as const;

const emitted = (effects: ReturnType<typeof transition>[1]) =>
  effects.flatMap((e) => (e.kind === "emit" ? [e.event] : []));

describe("the Recording Session machine, run with the pure transition()", () => {
  it("follows a started Recording Session, and its effects are data", () => {
    const [idle] = initialTransition(recorderSessionMachine);
    const [following, effects] = transition(
      recorderSessionMachine,
      idle,
      started
    );
    expect(following.value).toEqual({ following: "recording" });
    expect(emitted(effects)).toEqual([
      {
        type: "start-session",
        recordingSessionId: "s1",
        silenceLength: "long",
      },
    ]);
  });

  it("narrows the followed id by state: a string while following, null while idle", () => {
    const [idle] = initialTransition(recorderSessionMachine);
    const [following] = transition(recorderSessionMachine, idle, started);
    if (following.matches("following"))
      expectTypeOf(
        following.context.recordingSessionId
      ).toEqualTypeOf<string>();
    if (idle.matches("idle"))
      expectTypeOf(idle.context.recordingSessionId).toEqualTypeOf<null>();
    expect(following.matches("following")).toBe(true);
  });

  it("leaves Stop unhandled while idle, and a replay of an ended Recording Session too (#2163)", () => {
    const [idle] = initialTransition(recorderSessionMachine);
    expect(
      isUnhandled(
        idle,
        transition(recorderSessionMachine, idle, { type: "press-stop" })
      )
    ).toBe(true);

    const [following] = transition(recorderSessionMachine, idle, started);
    const [over] = transition(recorderSessionMachine, following, {
      type: "recording-stopped",
      recordingSessionId: "s1",
    });
    expect(
      isUnhandled(over, transition(recorderSessionMachine, over, started))
    ).toBe(true);
  });
});
