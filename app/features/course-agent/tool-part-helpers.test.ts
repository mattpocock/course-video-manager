import { describe, it, expect } from "vitest";
import {
  vfsToolIsStreaming,
  writeToolStreamingLabel,
} from "./tool-part-helpers";

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
