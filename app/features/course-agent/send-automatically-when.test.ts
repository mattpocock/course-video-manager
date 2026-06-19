import { describe, it, expect } from "vitest";
import { courseAgentSendAutomaticallyWhen } from "./types";
import type { UIMessage } from "ai";

function makeMsg(
  role: "user" | "assistant",
  parts: Array<{ type: string; state?: string }>
): UIMessage {
  return {
    id: "msg-1",
    role,
    parts: parts as UIMessage["parts"],
  };
}

describe("courseAgentSendAutomaticallyWhen", () => {
  it("returns false for empty messages", () => {
    expect(courseAgentSendAutomaticallyWhen({ messages: [] })).toBe(false);
  });

  it("returns false when last message is from user", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [makeMsg("user", [{ type: "text" }])],
      })
    ).toBe(false);
  });

  it("returns false when no tool parts", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [makeMsg("assistant", [{ type: "text" }])],
      })
    ).toBe(false);
  });

  it("returns true when all tools have output-available", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "output-available" },
          ]),
        ],
      })
    ).toBe(true);
  });

  it("returns true when all tools have output-denied", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "output-denied" },
          ]),
        ],
      })
    ).toBe(true);
  });

  it("returns true when all tools have output-error", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [{ type: "tool-write", state: "output-error" }]),
        ],
      })
    ).toBe(true);
  });

  it("returns true with mixed terminal states", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "output-available" },
            { type: "tool-edit", state: "output-denied" },
          ]),
        ],
      })
    ).toBe(true);
  });

  it("returns false when a tool is still pending approval", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "approval-requested" },
          ]),
        ],
      })
    ).toBe(false);
  });

  it("returns false when a tool is still streaming input", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "input-streaming" },
          ]),
        ],
      })
    ).toBe(false);
  });

  it("returns false with mixed terminal and non-terminal", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "tool-write", state: "output-available" },
            { type: "tool-edit", state: "approval-requested" },
          ]),
        ],
      })
    ).toBe(false);
  });

  it("ignores non-tool parts when checking", () => {
    expect(
      courseAgentSendAutomaticallyWhen({
        messages: [
          makeMsg("assistant", [
            { type: "text" },
            { type: "tool-write", state: "output-available" },
          ]),
        ],
      })
    ).toBe(true);
  });
});
