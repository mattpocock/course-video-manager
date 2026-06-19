import { describe, it, expect } from "vitest";
import { formatTranscript } from "./format-transcript";
import type { UIMessage } from "ai";

function makeMsg(
  role: "user" | "assistant",
  parts: Array<Record<string, unknown>>
): UIMessage {
  return {
    id: `msg-${Math.random()}`,
    role,
    parts: parts as UIMessage["parts"],
  };
}

describe("formatTranscript", () => {
  it("returns empty string for no messages", () => {
    expect(formatTranscript([])).toBe("");
  });

  it("formats a single user text message", () => {
    const msgs = [makeMsg("user", [{ type: "text", text: "Hello" }])];
    expect(formatTranscript(msgs)).toBe("User:\nHello");
  });

  it("formats a single assistant text message", () => {
    const msgs = [makeMsg("assistant", [{ type: "text", text: "Hi there" }])];
    expect(formatTranscript(msgs)).toBe("Assistant:\nHi there");
  });

  it("formats a multi-turn conversation", () => {
    const msgs = [
      makeMsg("user", [{ type: "text", text: "What is this course about?" }]),
      makeMsg("assistant", [
        { type: "text", text: "This course covers TypeScript." },
      ]),
      makeMsg("user", [{ type: "text", text: "Thanks!" }]),
    ];
    expect(formatTranscript(msgs)).toBe(
      [
        "User:\nWhat is this course about?",
        "Assistant:\nThis course covers TypeScript.",
        "User:\nThanks!",
      ].join("\n\n")
    );
  });

  it("includes VFS tool calls as bracketed labels", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "text", text: "Let me check." },
        {
          type: "tool-cat",
          toolName: "cat",
          state: "output-available",
          input: { path: "src/index.ts" },
          output: "file content",
        },
        { type: "text", text: "Here's what I found." },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe(
      "Assistant:\nLet me check.\n[Tool: cat src/index.ts]\nHere's what I found."
    );
  });

  it("includes write/edit tool calls as bracketed labels", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          toolCallId: "tc-1",
          state: "output-available",
          input: { path: "src/app.ts" },
          output: { applied: true, content: "", hash: "a", renames: [] },
        },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe("Assistant:\n[Tool: write src/app.ts]");
  });

  it("skips empty text parts", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "text", text: "" },
        { type: "text", text: "Only this" },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe("Assistant:\nOnly this");
  });

  it("skips data-proposed-ops parts", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "data-proposed-ops", id: "x", data: {} },
        { type: "text", text: "Done" },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe("Assistant:\nDone");
  });

  it("joins multiple text parts with newlines", () => {
    const msgs = [
      makeMsg("assistant", [
        { type: "text", text: "First paragraph." },
        { type: "text", text: "Second paragraph." },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe(
      "Assistant:\nFirst paragraph.\nSecond paragraph."
    );
  });

  it("skips messages with only unrecognized parts", () => {
    const msgs = [
      makeMsg("assistant", [{ type: "data-proposed-ops", id: "x", data: {} }]),
      makeMsg("user", [{ type: "text", text: "Hi" }]),
    ];
    expect(formatTranscript(msgs)).toBe("User:\nHi");
  });

  it("includes edit tool calls as bracketed labels", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-edit",
          toolCallId: "tc-2",
          state: "output-available",
          input: { path: "src/utils.ts" },
          output: { applied: true, content: "", hash: "b", renames: [] },
        },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe(
      "Assistant:\n[Tool: edit src/utils.ts]"
    );
  });

  it("handles tool calls with no path argument", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-cat",
          toolName: "cat",
          state: "output-available",
          input: {},
          output: "",
        },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe("Assistant:\n[Tool: cat]");
  });

  it("labels rejected write tool calls", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-write",
          toolCallId: "tc-1",
          state: "output-denied",
          input: { path: "src/app.ts" },
        },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe(
      "Assistant:\n[Rejected: write src/app.ts]"
    );
  });

  it("labels rejected edit tool calls", () => {
    const msgs = [
      makeMsg("assistant", [
        {
          type: "tool-edit",
          toolCallId: "tc-2",
          state: "output-denied",
          input: { path: "src/utils.ts" },
        },
      ]),
    ];
    expect(formatTranscript(msgs)).toBe(
      "Assistant:\n[Rejected: edit src/utils.ts]"
    );
  });
});
