import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeFfmpegLogger } from "./ffmpeg-video-logger";

describe("makeFfmpegLogger", () => {
  it("logs a cli-output event stage-prefixed with the joined command", () => {
    const calls: { videoId: string; event: unknown }[] = [];
    const fakeLogger = {
      log: (videoId: string, event: unknown) =>
        Effect.sync(() => {
          calls.push({ videoId, event });
        }),
    };

    const onLog = makeFfmpegLogger(fakeLogger, "video-1", "export:concat");
    onLog({ command: ["ffmpeg", "-y", "-i", "in.mp4"], stderrTail: "warn" });

    expect(calls).toEqual([
      {
        videoId: "video-1",
        event: {
          type: "cli-output",
          command: "[export:concat] ffmpeg -y -i in.mp4",
          stderr: "warn",
        },
      },
    ]);
  });

  it("never throws when the underlying logger fails", () => {
    const fakeLogger = {
      log: () => Effect.fail(new Error("disk full")),
    };

    const onLog = makeFfmpegLogger(fakeLogger as any, "video-1", "stage");

    expect(() => onLog({ command: ["ffmpeg"], stderrTail: "" })).not.toThrow();
  });

  it("never throws when the underlying logger itself throws synchronously", () => {
    const fakeLogger = {
      log: () =>
        Effect.sync(() => {
          throw new Error("boom");
        }),
    };

    const onLog = makeFfmpegLogger(fakeLogger as any, "video-1", "stage");

    expect(() => onLog({ command: ["ffmpeg"], stderrTail: "" })).not.toThrow();
  });
});
