import { describe, it, expect } from "vitest";
import { findAppliedToolCallIds } from "./revalidation-trigger";
import type { UIMessage } from "ai";

function makeMsg(
  role: "user" | "assistant",
  parts: Array<Record<string, unknown>>
): UIMessage {
  return { id: "msg-1", role, parts: parts as UIMessage["parts"] };
}

describe("findAppliedToolCallIds", () => {
  it("returns empty set for empty messages", () => {
    expect(findAppliedToolCallIds([])).toEqual(new Set());
  });

  it("returns empty set for user messages", () => {
    const msgs = [makeMsg("user", [{ type: "text", text: "hi" }])];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns empty set for non-write/edit tool parts", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-cat",
          state: "output-available",
          toolCallId: "tc-1",
          output: { content: "..." },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns empty set for approval-requested state", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          state: "approval-requested",
          toolCallId: "tc-1",
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns empty set for output-denied state", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "tool-write", state: "output-denied", toolCallId: "tc-1" },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns empty set for output-error state", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "tool-write", state: "output-error", toolCallId: "tc-1" },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns empty set for output-available with applied:false", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          state: "output-available",
          toolCallId: "tc-1",
          output: {
            applied: false,
            rejection: { kind: "stale", message: "File changed" },
          },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set());
  });

  it("returns toolCallId for write tool with applied:true", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          state: "output-available",
          toolCallId: "tc-1",
          output: {
            applied: true,
            content: "...",
            hash: "abc",
            renames: [],
          },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set(["tc-1"]));
  });

  it("returns toolCallId for edit tool with applied:true", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-edit",
          state: "output-available",
          toolCallId: "tc-2",
          output: {
            applied: true,
            content: "...",
            hash: "abc",
            renames: [],
          },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set(["tc-2"]));
  });

  it("collects from multiple messages", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          state: "output-available",
          toolCallId: "tc-1",
          output: { applied: true, content: "", hash: "a", renames: [] },
        },
      ]),
      makeMsg("assistant", [
        {
          type: "tool-edit",
          state: "output-available",
          toolCallId: "tc-2",
          output: { applied: true, content: "", hash: "b", renames: [] },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set(["tc-1", "tc-2"]));
  });

  it("skips rejected among applied", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          state: "output-available",
          toolCallId: "tc-1",
          output: { applied: true, content: "", hash: "a", renames: [] },
        },
        {
          type: "tool-edit",
          state: "output-available",
          toolCallId: "tc-2",
          output: {
            applied: false,
            rejection: { kind: "forbidden-op", message: "nope" },
          },
        },
      ]),
    ];
    expect(findAppliedToolCallIds(msgs)).toEqual(new Set(["tc-1"]));
  });
});
