import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  RenderVerticalError,
  RenderVerticalVideoService,
} from "@/services/render-vertical-video-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import type { JobContext } from "../job-kind";
import { renderVerticalJobKind } from "./render-vertical";

const STAGES = [
  "concatenating-clips",
  "rendering-overlay",
  "compositing",
] as const;

/**
 * A render that walks every stage, then ends as `outcome` says — beside what
 * the real one needs to be called: the Sidecar's proof, and a process runner.
 */
const fakeRender = (outcome: "succeed" | "fail") =>
  Layer.mergeAll(
    SidecarContextTest,
    NodeContext.layer,
    Layer.succeed(
      RenderVerticalVideoService,
      RenderVerticalVideoService.make({
        renderVerticalVideo: (opts) =>
          Effect.gen(function* () {
            for (const stage of STAGES) {
              opts.onStageChange?.(stage);
              yield* Effect.yieldNow();
            }
            if (outcome === "fail") {
              return yield* new RenderVerticalError({
                cause: null,
                message: "Overlay renderer exited with code 1: boom",
              });
            }
            return `/finished/${opts.videoId}.mp4`;
          }),
      })
    )
  );

const recordingContext = () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const ctx: JobContext = {
    jobId: "job-1",
    attempt: 1,
    maxAttempts: 3,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: (type, data) =>
      Effect.sync(() => {
        events.push({ type, data });
      }),
  };
  return { ctx, events };
};

describe("the render-vertical Job kind", () => {
  it.effect(
    "reports every stage as a Job Event, in order, then the file it wrote",
    () =>
      Effect.gen(function* () {
        const { ctx, events } = recordingContext();
        yield* renderVerticalJobKind.runRaw({ videoId: "video-1" }, ctx);
        expect(events).toEqual([
          ...STAGES.map((stage) => ({ type: "stage", data: { stage } })),
          { type: "rendered", data: { path: "/finished/video-1.mp4" } },
        ]);
      }).pipe(Effect.provide(fakeRender("succeed")))
  );

  it.effect(
    "fails with the renderer's own error, after writing the stages it reached",
    () =>
      Effect.gen(function* () {
        const { ctx, events } = recordingContext();
        const error = yield* renderVerticalJobKind
          .runRaw({ videoId: "video-1" }, ctx)
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "RenderVerticalError",
          message: "Overlay renderer exited with code 1: boom",
        });
        expect(events.map((e) => e.data.stage)).toEqual([...STAGES]);
      }).pipe(Effect.provide(fakeRender("fail")))
  );
});
