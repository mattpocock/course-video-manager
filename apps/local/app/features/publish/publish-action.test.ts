import { describe, expect, it } from "vitest";
import { decidePublishAction, type PublishActionInput } from "./publish-action";

const input = (overrides: Partial<PublishActionInput> = {}) =>
  decidePublishAction({
    pendingRecovery: false,
    hasBlockers: false,
    hasVersionDescription: true,
    autofillRunning: false,
    publishRunning: false,
    ...overrides,
  });

describe("the publish page's Publish button", () => {
  it("is hidden while a Pending Version is at rest", () => {
    expect(input({ pendingRecovery: true })).toEqual({ kind: "hidden" });
  });

  it("publishes when nothing the Autofill leaves behind blocks it", () => {
    expect(input()).toEqual({
      kind: "publish",
      label: "Publish",
      enabled: true,
    });
  });

  it("is disabled when blockers the Autofill cannot clear remain", () => {
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

  it("reads Filling… while the hidden Autofill runs, then Publishing…", () => {
    // The Publish is queued behind the Autofill, so both are live at first.
    expect(input({ autofillRunning: true, publishRunning: true })).toEqual({
      kind: "publish",
      label: "Filling…",
      enabled: false,
    });
    expect(input({ publishRunning: true })).toEqual({
      kind: "publish",
      label: "Publishing…",
      enabled: false,
    });
  });
});
