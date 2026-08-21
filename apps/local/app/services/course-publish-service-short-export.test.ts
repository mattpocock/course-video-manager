/**
 * What a Publish does with a renderer that produced a short file.
 *
 * ffmpeg exiting zero says only that it stopped without complaining. These
 * tests run the real publish logic against a renderer that writes a file and
 * then reports it as shorter than its Clips ask for, and pin the two things
 * that must follow: the Publish fails the export by name, and the short file
 * never reaches its content-addressed path.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { CoursePublishService } from "@/services/course-publish-service";
import { resolveExportPath } from "@/services/export-hash";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

const publishExpectingFailure = (
  run: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>,
  courseId: string
) =>
  run(
    Effect.gen(function* () {
      const svc = yield* CoursePublishService;
      return yield* svc
        .publish({
          courseId,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
        })
        .pipe(
          Effect.catchTag("PublishValidationError", (e) =>
            Effect.succeed({
              failed: true as const,
              failedExportVideoIds: e.failedExportVideoIds,
            })
          )
        );
    })
  );

describe("CoursePublishService — when an export comes out short", () => {
  it(
    "fails the Publish and names the Video whose export was short",
    async () => {
      const { course, video, run } = await setup({
        renderDurationInSeconds: (render) =>
          render.requestedDurationInSeconds - 5,
      });

      const result = await publishExpectingFailure(run, course.id);

      expect(result).toHaveProperty("failed", true);
      expect((result as any).failedExportVideoIds).toContain(video.id);
    },
    60_000
  );

  it(
    "never lets a short export reach its content-addressed path",
    async () => {
      const { course, exportHash, run } = await setup({
        renderDurationInSeconds: (render) =>
          render.requestedDurationInSeconds - 5,
      });

      await publishExpectingFailure(run, course.id);

      // Nothing downstream can address a file that is not there, so the next
      // attempt re-encodes rather than skipping.
      const exportPath = resolveExportPath(
        finishedVideosDir,
        course.id,
        exportHash!
      );
      expect(fs.existsSync(exportPath)).toBe(false);
    },
    60_000
  );

  it(
    "accepts an export longer than its Clips ask for",
    async () => {
      const { course, exportHash, run } = await setup({
        renderDurationInSeconds: (render) =>
          render.requestedDurationInSeconds + 0.4,
      });

      const outcome = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
          });
        })
      );

      expect(outcome.publishedVersionId).toBeTruthy();
      expect(
        fs.existsSync(resolveExportPath(finishedVideosDir, course.id, exportHash!))
      ).toBe(true);
    },
    60_000
  );

  it(
    "refuses a zero-length export",
    async () => {
      const { course, video, run } = await setup({
        renderDurationInSeconds: () => 0,
      });

      const result = await publishExpectingFailure(run, course.id);

      expect((result as any).failedExportVideoIds).toContain(video.id);
    },
    60_000
  );
});
