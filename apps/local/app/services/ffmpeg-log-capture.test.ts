import { describe, expect, it } from "vitest";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";

describe("appendBoundedTail", () => {
  it("concatenates chunks while under the limit", () => {
    const tail = appendBoundedTail(
      appendBoundedTail("", "frame=1 fps=30\n", 100),
      "frame=2 fps=30\n",
      100
    );
    expect(tail).toBe("frame=1 fps=30\nframe=2 fps=30\n");
  });

  it("keeps only the last maxChars once the combined text overflows", () => {
    const tail = appendBoundedTail("a".repeat(10), "b".repeat(10), 15);
    expect(tail).toBe("a".repeat(5) + "b".repeat(10));
    expect(tail.length).toBe(15);
  });

  it("truncates a single oversized chunk to its own tail", () => {
    const tail = appendBoundedTail("", "x".repeat(50), 10);
    expect(tail).toBe("x".repeat(10));
  });

  it("defaults to MAX_STDERR_TAIL_CHARS when no limit is given", () => {
    const tail = appendBoundedTail("", "y".repeat(10_000));
    expect(tail.length).toBe(8_000);
  });
});

describe("withStderrTail", () => {
  it("returns the message unchanged when there is no captured output", () => {
    expect(withStderrTail("Failed to export", "")).toBe("Failed to export");
  });

  it("appends the tail under a labelled separator when present", () => {
    expect(
      withStderrTail("Failed to export", "Unknown encoder 'h264_nvenc'")
    ).toBe(
      "Failed to export\n--- ffmpeg stderr (tail) ---\nUnknown encoder 'h264_nvenc'"
    );
  });
});
