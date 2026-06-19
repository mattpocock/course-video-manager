import { describe, it, expect } from "vitest";
import {
  asVfsToolPart,
  asWriteToolPart,
  vfsToolIsStreaming,
  writeToolStreamingLabel,
} from "./tool-part-helpers";
import type { UIMessage } from "ai";

type Part = UIMessage["parts"][number];

function makePart(fields: Record<string, unknown>): Part {
  return fields as Part;
}

describe("asWriteToolPart", () => {
  it("extracts errorText from output-error state", () => {
    const part = makePart({
      type: "tool-write",
      toolCallId: "tc-1",
      state: "output-error",
      errorText: "Something went wrong",
    });
    const result = asWriteToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("output-error");
    expect(result!.errorText).toBe("Something went wrong");
  });

  it("returns undefined errorText for non-error states", () => {
    const part = makePart({
      type: "tool-write",
      toolCallId: "tc-1",
      state: "output-available",
      output: { applied: true, content: "", hash: "a", renames: [] },
    });
    const result = asWriteToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.errorText).toBeUndefined();
  });

  it("extracts errorText from dynamic-tool with output-error", () => {
    const part = makePart({
      type: "dynamic-tool",
      toolName: "edit",
      toolCallId: "tc-2",
      state: "output-error",
      errorText: "Edit failed",
    });
    const result = asWriteToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("output-error");
    expect(result!.errorText).toBe("Edit failed");
  });
});

describe("asVfsToolPart", () => {
  it("extracts errorText from output-error state", () => {
    const part = makePart({
      type: "tool-cat",
      state: "output-error",
      errorText: "No such file or directory",
    });
    const result = asVfsToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("output-error");
    expect(result!.errorText).toBe("No such file or directory");
  });

  it("returns undefined errorText for non-error states", () => {
    const part = makePart({
      type: "tool-ls",
      state: "output-available",
      output: "dir1/\ndir2/",
    });
    const result = asVfsToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.errorText).toBeUndefined();
  });

  it("extracts errorText from dynamic-tool with output-error", () => {
    const part = makePart({
      type: "dynamic-tool",
      toolName: "grep",
      state: "output-error",
      errorText: "Pattern not found",
    });
    const result = asVfsToolPart(part);
    expect(result).not.toBeNull();
    expect(result!.toolName).toBe("grep");
    expect(result!.state).toBe("output-error");
    expect(result!.errorText).toBe("Pattern not found");
  });
});

describe("vfsToolIsStreaming", () => {
  it("returns true for input-streaming", () => {
    expect(vfsToolIsStreaming("input-streaming")).toBe(true);
  });

  it("returns true for input-available", () => {
    expect(vfsToolIsStreaming("input-available")).toBe(true);
  });

  it("returns false for output-available", () => {
    expect(vfsToolIsStreaming("output-available")).toBe(false);
  });

  it("returns false for output-error", () => {
    expect(vfsToolIsStreaming("output-error")).toBe(false);
  });

  it("returns false for output-denied", () => {
    expect(vfsToolIsStreaming("output-denied")).toBe(false);
  });

  it("returns true for empty state", () => {
    expect(vfsToolIsStreaming("")).toBe(true);
  });
});

describe("writeToolStreamingLabel", () => {
  it('returns "Writing…" for write tool in input-streaming', () => {
    expect(writeToolStreamingLabel("write", "input-streaming")).toBe(
      "Writing…"
    );
  });

  it('returns "Editing…" for edit tool in input-streaming', () => {
    expect(writeToolStreamingLabel("edit", "input-streaming")).toBe("Editing…");
  });

  it('returns "Writing…" for write tool in input-available', () => {
    expect(writeToolStreamingLabel("write", "input-available")).toBe(
      "Writing…"
    );
  });

  it('returns "Applying changes…" for approval-responded', () => {
    expect(writeToolStreamingLabel("edit", "approval-responded")).toBe(
      "Applying changes…"
    );
  });

  it("returns null for output-available", () => {
    expect(writeToolStreamingLabel("write", "output-available")).toBeNull();
  });

  it("returns null for approval-requested", () => {
    expect(writeToolStreamingLabel("write", "approval-requested")).toBeNull();
  });

  it("returns null for output-denied", () => {
    expect(writeToolStreamingLabel("edit", "output-denied")).toBeNull();
  });

  it("returns null for output-error", () => {
    expect(writeToolStreamingLabel("write", "output-error")).toBeNull();
  });
});
