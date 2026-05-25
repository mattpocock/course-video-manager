import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { DoesNotExistOnDbError } from "@/services/publish-to-dropbox";
import { NodeContext } from "@effect/platform-node";
import { CourseRepoParserService } from "@/services/course-repo-parser";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

function routeEffect(formDataObject: Record<string, unknown>) {
  return Effect.gen(function* () {
    const result =
      yield* Schema.decodeUnknown(publishRepoSchema)(formDataObject);

    const publishService = yield* CoursePublishService;
    return yield* publishService.syncToDropbox(result.repoId);
  });
}

function mockPublishService(
  syncToDropboxImpl: (
    courseId: string
  ) => Effect.Effect<{ missingVideos: unknown[] }, unknown>
) {
  return Layer.succeed(CoursePublishService, {
    syncToDropbox: syncToDropboxImpl,
  } as unknown as CoursePublishService);
}

const unusedDeps = Layer.mergeAll(
  NodeContext.layer,
  Layer.succeed(
    CourseRepoParserService,
    {} as unknown as CourseRepoParserService
  )
);

describe("api.courses.publish-to-dropbox", () => {
  it.effect(
    "delegates to CoursePublishService.syncToDropbox with the parsed repoId",
    () => {
      let capturedCourseId: string | undefined;
      const expectedMissingVideos = [
        { videoId: "v1", videoPath: "video.mp4", lessonPath: "01-intro" },
      ];

      return routeEffect({ repoId: "course-abc" }).pipe(
        Effect.provide(
          mockPublishService((courseId) => {
            capturedCourseId = courseId;
            return Effect.succeed({ missingVideos: expectedMissingVideos });
          })
        ),
        Effect.provide(unusedDeps),
        Effect.map((result) => {
          expect(capturedCourseId).toBe("course-abc");
          expect(result).toEqual({ missingVideos: expectedMissingVideos });
        })
      );
    }
  );

  it.effect("returns empty missingVideos when all videos are present", () =>
    routeEffect({ repoId: "course-xyz" }).pipe(
      Effect.provide(
        mockPublishService(() => Effect.succeed({ missingVideos: [] }))
      ),
      Effect.provide(unusedDeps),
      Effect.map((result) => {
        expect(result).toEqual({ missingVideos: [] });
      })
    )
  );

  it.effect("fails with ParseError when repoId is missing", () =>
    routeEffect({}).pipe(
      Effect.provide(
        mockPublishService(() => Effect.succeed({ missingVideos: [] }))
      ),
      Effect.provide(unusedDeps),
      Effect.flip,
      Effect.map((error) => {
        expect((error as { _tag: string })._tag).toBe("ParseError");
      })
    )
  );

  it.effect("propagates DoesNotExistOnDbError from the service", () =>
    routeEffect({ repoId: "course-123" }).pipe(
      Effect.provide(
        mockPublishService(
          () =>
            new DoesNotExistOnDbError({
              type: "section",
              path: "01-intro",
              message: "Section 01-intro does not exist on the database",
            })
        )
      ),
      Effect.provide(unusedDeps),
      Effect.flip,
      Effect.map((error) => {
        expect((error as { _tag: string })._tag).toBe("DoesNotExistOnDbError");
      })
    )
  );
});
