import { describe, expect, it } from "vitest";
import { decidePublishAction, type PublishActionInput } from "./publish-action";

const input = (overrides: Partial<PublishActionInput> = {}) =>
  decidePublishAction({
    pendingRecovery: false,
    autofillCandidateCount: 0,
    hasBlockers: false,
    hasVersionDescription: true,
    autofillRunning: false,
    publishRunning: false,
    ...overrides,
  });

describe("the publish page's one button", () => {
  it("is hidden while a Pending Version is at rest", () => {
    // Even with work outstanding: the recovery banner is the only decision.
    expect(input({ pendingRecovery: true, autofillCandidateCount: 4 })).toEqual(
      { kind: "hidden" }
    );
  });

  it("offers the Autofill, counted, while candidates exist", () => {
    expect(input({ autofillCandidateCount: 4, hasBlockers: true })).toEqual({
      kind: "autofill",
      count: 4,
      label: "Autofill 4 Videos",
      enabled: true,
    });
  });

  it("counts one Video in the singular", () => {
    const action = input({ autofillCandidateCount: 1 });
    expect(action.kind === "autofill" && action.label).toBe("Autofill 1 Video");
  });

  it("publishes when there are no candidates and readiness is clean", () => {
    expect(input()).toEqual({
      kind: "publish",
      label: "Publish",
      enabled: true,
    });
  });

  it("reads Publish and is disabled when blockers the Autofill cannot clear remain", () => {
    expect(input({ hasBlockers: true })).toEqual({
      kind: "publish",
      label: "Publish",
      enabled: false,
    });
  });

  it("refuses a Publish with no version description", () => {
    expect(input({ hasVersionDescription: false })).toEqual({
      kind: "publish",
      label: "Publish",
      enabled: false,
    });
  });

  it("holds both actions while an Autofill is running", () => {
    expect(input({ autofillCandidateCount: 2, autofillRunning: true })).toEqual(
      {
        kind: "autofill",
        count: 2,
        label: "Autofilling…",
        enabled: false,
      }
    );
    // Nothing left to autofill, but the run is still settling: the Publish
    // waits rather than racing it for the same Draft.
    expect(input({ autofillRunning: true })).toEqual({
      kind: "publish",
      label: "Publish",
      enabled: false,
    });
  });

  it("holds the Autofill while a Publish is running", () => {
    expect(input({ autofillCandidateCount: 3, publishRunning: true })).toEqual({
      kind: "autofill",
      count: 3,
      label: "Autofill 3 Videos",
      enabled: false,
    });
  });
});
