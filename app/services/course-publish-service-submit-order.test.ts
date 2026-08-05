import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import fs from "node:fs";
import path from "node:path";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { CoursePublishService } from "@/services/course-publish-service";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { courseVersions as courseVersionsTable } from "@/db/schema";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

describe("CoursePublishService — Submit before export", () => {
  it("leaves every Video's Export Hash untouched across Submit", async () => {
    // The bundle path is derived from these, and it is computed before Submit
    // but used after it. The freeze-and-clone must therefore copy Clip
    // filenames, source timings and order verbatim, and never mutate the
    // source rows.
    const { course, version, run } = await setup();

    const exportHashesFor = (versionId: string) =>
      run(
        Effect.gen(function* () {
          const versionOps = yield* VersionOperationsService;
          const withSections =
            yield* versionOps.getVersionWithSections(versionId);
          return withSections.sections.flatMap((section) =>
            section.lessons.flatMap((lesson) =>
              lesson.videos.map((v) =>
                computeExportHash(toExportClips(v.clips), v.format)
              )
            )
          );
        })
      );

    const before = await exportHashesFor(version.id);

    const { newDraftVersionId } = await run(
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

    expect(before).toHaveLength(1);
    expect(before[0]).toBeTruthy();
    // Unchanged on the Submitted Version, and carried verbatim into the clone.
    expect(await exportHashesFor(version.id)).toEqual(before);
    expect(await exportHashesFor(newDraftVersionId)).toEqual(before);
  });

  it("Submits before exporting, so encoding operates on a Pending Version", async () => {
    // While a Course Version is a Draft it legally accepts Clip, Video and
    // Section writes — and a Video's title is its path inside the bundle. So
    // the freeze has to happen before a single frame is encoded.
    const commitStatesDuringExport: string[][] = [];
    const observingMock = Layer.succeed(VideoProcessingService, {
      exportVideoClips: (exportOpts: any) =>
        Effect.promise(async () => {
          const rows = await testDb.select().from(courseVersionsTable);
          commitStatesDuringExport.push(
            rows.map((row) => row.commitState).sort()
          );
          const outputPath = path.join(
            finishedVideosDir,
            `${exportOpts.videoId}.mp4`
          );
          fs.writeFileSync(outputPath, "dummy-video-content");
          return outputPath;
        }),
    } as any);

    const { course, run } = await setup({ mockVideoProcessing: observingMock });

    const stages: string[] = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          onStageChange: (stage) => {
            stages.push(stage);
          },
        });
      })
    );

    expect(commitStatesDuringExport).toEqual([["draft", "pending"]]);
    expect(stages.indexOf("freezing")).toBeLessThan(
      stages.indexOf("exporting")
    );
    expect(stages.indexOf("cloning")).toBeLessThan(stages.indexOf("exporting"));
    expect(stages.indexOf("exporting")).toBeLessThan(
      stages.indexOf("uploading")
    );
  });

  it("Discards the Pending Version when export fails, leaving no version to reconcile", async () => {
    const failingMock = Layer.succeed(VideoProcessingService, {
      exportVideoClips: () => Effect.fail(new Error("ffmpeg crashed")),
    } as any);
    const { course, run } = await setup({ mockVideoProcessing: failingMock });

    const versions = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
          })
          .pipe(Effect.catchTag("PublishValidationError", () => Effect.void));
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.getCourseVersions(course.id);
      })
    );

    // Submit now runs first, so a failed export leaves a Pending Version
    // behind. It must be Discarded, not left at rest for manual reconciliation.
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ name: "", commitState: "draft" });
  });
});
