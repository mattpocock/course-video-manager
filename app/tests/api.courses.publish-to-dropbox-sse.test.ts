import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { DoesNotExistOnDbError } from "@/services/publish-to-dropbox";
import { NodeContext } from "@effect/platform-node";
import { CourseRepoParserService } from "@/services/course-repo-parser";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

function routeEffect(
  body: Record<string, unknown>,
  sendEvent: (event: string, data: unknown) => void
) {
  return Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(publishRepoSchema)(body);

    const publishService = yield* CoursePublishService;
    const { missingVideos } = yield* publishService.syncToDropbox(
      result.repoId,
      sendEvent
    );

    sendEvent("complete", {
      missingVideoCount: missingVideos.length,
    });
  });
}

function mockPublishService(
  syncToDropboxImpl: (
    courseId: string,
    onProgress?: (event: string, data: unknown) => void
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

describe("api.courses.publish-to-dropbox-sse", () => {
  it.effect(
    "delegates to CoursePublishService.syncToDropbox with the parsed repoId and sendEvent",
    () => {
      let capturedCourseId: string | undefined;
      let capturedOnProgress:
        | ((event: string, data: unknown) => void)
        | undefined;
      const events: Array<{ event: string; data: unknown }> = [];
      const sendEvent = (event: string, data: unknown) => {
        events.push({ event, data });
      };

      return routeEffect({ repoId: "course-abc" }, sendEvent).pipe(
        Effect.provide(
          mockPublishService((courseId, onProgress) => {
            capturedCourseId = courseId;
            capturedOnProgress = onProgress;
            onProgress?.("progress", { percentage: 50 });
            onProgress?.("progress", { percentage: 100 });
            return Effect.succeed({ missingVideos: [{ videoId: "v1" }] });
          })
        ),
        Effect.provide(unusedDeps),
        Effect.map(() => {
          expect(capturedCourseId).toBe("course-abc");
          expect(capturedOnProgress).toBe(sendEvent);
          expect(events).toEqual([
            { event: "progress", data: { percentage: 50 } },
            { event: "progress", data: { percentage: 100 } },
            { event: "complete", data: { missingVideoCount: 1 } },
          ]);
        })
      );
    }
  );

  it.effect(
    "emits complete with missingVideoCount 0 when no videos missing",
    () => {
      const events: Array<{ event: string; data: unknown }> = [];
      const sendEvent = (event: string, data: unknown) => {
        events.push({ event, data });
      };

      return routeEffect({ repoId: "course-xyz" }, sendEvent).pipe(
        Effect.provide(
          mockPublishService(() => Effect.succeed({ missingVideos: [] }))
        ),
        Effect.provide(unusedDeps),
        Effect.map(() => {
          expect(events).toEqual([
            { event: "complete", data: { missingVideoCount: 0 } },
          ]);
        })
      );
    }
  );

  it.effect("fails with ParseError when repoId is missing", () =>
    routeEffect({}, () => {}).pipe(
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
    routeEffect({ repoId: "course-123" }, () => {}).pipe(
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
