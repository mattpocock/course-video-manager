import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  ClipNotZoomableError,
  NotFoundError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "@/services/db-service-errors";
import { VERSION_NOT_DRAFT_MESSAGE } from "@/services/version-not-draft-message";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { RemoteServices } from "./rpc-layer";
import {
  buildWriteLayer,
  makeRun,
  one,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// A typed domain error, raised on the far side of a network, arrives as the
// SAME TAGGED ERROR here.
//
// This is the contract the whole transport rests on. `Effect.flip` and `_tag`
// assertions behave exactly as they did when the services ran in-process, and
// the CLI's exit codes fall out of the tag — so a tag lost on the wire turns
// "that Video does not exist" into "internal error, exit 4" everywhere at
// once, silently. Every verb group is checked, because a group is only as
// covered as the test that names it.
//
// These call the services THROUGH THE CLI'S OWN LAYER, which is HTTP: an error
// reaching an assertion below has been encoded, serialised, sent, parsed and
// rebuilt. Nothing here can pass by accident on an in-process call.
// ===========================================================================

let testDb: TestDb;
let layer: ReturnType<typeof buildWriteLayer>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

/** The failure a call came back with, after its round trip. */
const raised = <A, E>(
  effect: Effect.Effect<A, E, RemoteServices>
): Promise<E> =>
  Effect.runPromise(effect.pipe(Effect.flip, Effect.provide(layer)));

interface PublishedFixture {
  readonly lessonId: string;
  readonly clipId: string;
  readonly versionId: string;
}

/**
 * A Course whose only Version is PUBLISHED — the immutable state every
 * structural write must refuse. Used for the VersionNotDraftError tests.
 */
const seedPublished = async (): Promise<PublishedFixture> => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Shipped", slug: "shipped" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "v1.0.0",
      commitState: "published",
    })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, title: "Welcome", order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "0001",
      text: "hello",
    })
    .returning();

  return { lessonId: lesson!.id, clipId: clip!.id, versionId: version!.id };
};

/** A standalone Video with one Clip, on the Draft side of the world. */
const seedDraftClip = async (): Promise<string> => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "standalone.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "0001",
      text: "hello",
    })
    .returning();
  return clip!.id;
};

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  layer = buildWriteLayer(testDb);
  run = makeRun(layer);
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("every verb group rebuilds the error the service raised", () => {
  it("course", async () => {
    const error = await raised(
      Effect.flatMap(CourseOperationsService, (svc) =>
        svc.getCourseById("course_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("version", async () => {
    const error = await raised(
      Effect.flatMap(VersionOperationsService, (svc) =>
        svc.getCourseVersionById("ver_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("section", async () => {
    const error = await raised(
      Effect.flatMap(LessonSectionOperationsService, (svc) =>
        svc.getSectionWithHierarchyById("sec_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("lesson", async () => {
    const error = await raised(
      Effect.flatMap(LessonSectionOperationsService, (svc) =>
        svc.getLessonWithHierarchyById("les_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("video", async () => {
    const error = await raised(
      Effect.flatMap(VideoOperationsService, (svc) =>
        svc.getVideoRowById("vid_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("clip", async () => {
    // A Clip whose scene is not one of the face-only OBS scenes cannot carry a
    // Zoom. The rule lives in the service; only its tag has to survive here.
    const clipId = await seedDraftClip();

    const error = await raised(
      Effect.flatMap(ClipOperationsService, (svc) =>
        svc.setClipZoom(clipId, "subtle")
      )
    );

    expect(error._tag).toBe("ClipNotZoomableError");
    expect(error).toBeInstanceOf(ClipNotZoomableError);
    // The message is what `cvm clip update --zoom` renders as its exit-3
    // explanation, so it has to arrive with the error.
    expect((error as ClipNotZoomableError).message).not.toBe("");
  });

  it("beat", async () => {
    const error = await raised(
      Effect.flatMap(BeatOperationsService, (svc) =>
        svc.getBeatById("beat_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("pitch", async () => {
    const error = await raised(
      Effect.flatMap(PitchOperationsService, (svc) =>
        svc.getPitch("pit_does_not_exist")
      )
    );

    expect(error._tag).toBe("NotFoundError");
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("deliverable", async () => {
    const error = await raised(
      Effect.flatMap(DeliverableOperationsService, (svc) =>
        svc.archiveDeliverable("del_does_not_exist")
      )
    );

    expect(error._tag).toBe("UnknownDBServiceError");
    expect(error).toBeInstanceOf(UnknownDBServiceError);
  });

  it("search", async () => {
    // Search's only failure is the database itself, so this one needs a
    // database that cannot answer.
    const broken = await createTestDb();
    await broken.pglite.close();

    const error = await Effect.runPromise(
      Effect.flatMap(SearchOperationsService, (svc) =>
        svc.search({
          root: null,
          query: "anything",
          types: new Set(["course"]),
        })
      ).pipe(Effect.flip, Effect.provide(buildWriteLayer(broken.testDb)))
    );

    expect(error._tag).toBe("UnknownDBServiceError");
    expect(error).toBeInstanceOf(UnknownDBServiceError);
  });
});

describe("what the wire refuses to carry", () => {
  it("drops the cause, which is where a failing SQL statement lives", async () => {
    const error = await raised(
      Effect.flatMap(DeliverableOperationsService, (svc) =>
        svc.archiveDeliverable("del_does_not_exist")
      )
    );

    // The server logs its own cause. Sending it would put a statement — and
    // sometimes the values in it — in a response body.
    expect((error as UnknownDBServiceError).cause).toBeUndefined();
  });
});

describe("VersionNotDraftError keeps its own message", () => {
  // Its message is a PROTOTYPE GETTER with no setter, not a field. Encoding it
  // would produce a payload that throws on the way back in, so the wire leaves
  // it out and the rebuilt error regenerates it — which only holds while the
  // error is rebuilt as its own CLASS. That is what these two assert.

  it("arrives as the class, with the message it computes for itself", async () => {
    const { lessonId, versionId } = await seedPublished();

    const error = await raised(
      Effect.flatMap(LessonSectionOperationsService, (svc) =>
        svc.updateLesson(lessonId, { title: "edited after publish" })
      )
    );

    expect(error._tag).toBe("VersionNotDraftError");
    expect(error).toBeInstanceOf(VersionNotDraftError);
    expect((error as VersionNotDraftError).message).toBe(
      VERSION_NOT_DRAFT_MESSAGE
    );
    // The fields it was raised with cross too — they say WHICH version and
    // what state it is in, which is what an agent needs to act.
    expect((error as VersionNotDraftError).versionId).toBe(versionId);
    expect((error as VersionNotDraftError).commitState).toBe("published");
  });

  it("reaches an agent's stderr, message and all", async () => {
    const { clipId } = await seedPublished();

    const { stdout, stderr, exitCode } = await run([
      "clip",
      "update",
      "--start",
      "1",
      clipId,
    ]);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    const failure = one<{ _tag: string; message: string }>(stderr.trim());
    expect(failure._tag).toBe("VersionNotDraftError");
    expect(failure.message).toBe(VERSION_NOT_DRAFT_MESSAGE);
  });
});

describe("an authentication failure is not a domain failure", () => {
  it("carries its own tag and its own exit code", async () => {
    const rejected = makeRun(
      buildWriteLayer(testDb, { token: "cvm_deadbeef_nope" })
    );

    const authFailure = await rejected(["video", "get", "vid_nope"]);
    const domainFailure = await run(["video", "get", "vid_nope"]);

    expect(one<{ _tag: string }>(authFailure.stderr.trim())._tag).toBe(
      "AuthenticationError"
    );
    expect(one<{ _tag: string }>(domainFailure.stderr.trim())._tag).toBe(
      "NotFoundError"
    );
    expect(authFailure.exitCode).toBe(5);
    expect(domainFailure.exitCode).toBe(2);
  });
});
