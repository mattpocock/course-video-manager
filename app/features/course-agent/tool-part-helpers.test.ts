import { describe, it, expect } from "vitest";
import {
  stringifyToolOutput,
  vfsToolIsStreaming,
  writeToolStreamingLabel,
} from "./tool-part-helpers";

describe("stringifyToolOutput", () => {
  it("returns a string value as-is", () => {
    expect(stringifyToolOutput("hello world")).toBe("hello world");
  });

  it("serializes a plain object to indented JSON", () => {
    const obj = { files: ["a.ts", "b.ts"] };
    expect(stringifyToolOutput(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it("serializes an array to indented JSON", () => {
    const arr = [1, 2, 3];
    expect(stringifyToolOutput(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("converts a number to its string representation", () => {
    expect(stringifyToolOutput(42)).toBe("42");
  });

  it("converts a boolean to its string representation", () => {
    expect(stringifyToolOutput(true)).toBe("true");
  });

  it("returns empty string for null", () => {
    expect(stringifyToolOutput(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(stringifyToolOutput(undefined)).toBe("");
  });

  it("falls back to String() for circular references", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(stringifyToolOutput(circular)).toBe("[object Object]");
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
