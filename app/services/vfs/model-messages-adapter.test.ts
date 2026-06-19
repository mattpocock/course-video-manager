import { describe, it, expect } from "vitest";
import { modelMessagesToDiffMessages } from "./model-messages-adapter";
import type { ModelMessage } from "ai";

describe("modelMessagesToDiffMessages", () => {
  it("maps tool-result output to result", () => {
    const catOutput = {
      content: '{"id":"s1"}',
      path: "/courses/my-course/sections/_members.json",
      hash: "abc123",
    };
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "cat",
            output: { type: "json", value: catOutput },
          },
        ],
      },
    ];

    const result = modelMessagesToDiffMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("tool");

    const content = result[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{
      type: string;
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    }>;
    expect(parts[0]!.type).toBe("tool-result");
    expect(parts[0]!.toolCallId).toBe("call-1");
    expect(parts[0]!.toolName).toBe("cat");
    expect(parts[0]!.result).toEqual(catOutput);
  });

  it("passes through user messages with string content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "hello",
      },
    ];

    const result = modelMessagesToDiffMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toBe("hello");
  });

  it("handles assistant messages with array content", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll read that file." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "cat",
            input: { path: "/courses/my-course/sections/_members.json" },
          },
        ],
      },
    ];

    const result = modelMessagesToDiffMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("assistant");
    const content = result[0]!.content as Array<{ type: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("tool-call");
  });

  it("handles multiple tool results in one message", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "cat",
            output: {
              type: "json",
              value: { content: "a", path: "/a", hash: "h1" },
            },
          },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "ls",
            output: { type: "text", value: "file1\nfile2" },
          },
        ],
      },
    ];

    const result = modelMessagesToDiffMessages(messages);
    const parts = result[0]!.content as Array<{
      type: string;
      result?: unknown;
    }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.result).toEqual({
      content: "a",
      path: "/a",
      hash: "h1",
    });
    expect(parts[1]!.result).toBe("file1\nfile2");
  });

  it("handles empty message array", () => {
    expect(modelMessagesToDiffMessages([])).toEqual([]);
  });
});
