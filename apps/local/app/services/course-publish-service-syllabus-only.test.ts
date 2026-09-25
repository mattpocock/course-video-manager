/**
 * A SYLLABUS-ONLY RELEASE, through the whole Publish (issue #1660).
 *
 * The pre-launch case: a release that announces the shape of a Course before a
 * frame of it has been filmed. Every Lesson is a Placeholder Lesson, the Bundle
 * holds no `.mp4` at all, and the release must still travel the entire pipe —
 * Submit, the empty upload pool, export garbage collection with nothing to
 * reclaim, the atomic `course.json` rename, and the promote.
 *
 * The Dropbox half of this (what lands in the Bundle directory, what the
 * manifest says) is pinned in `course-publish-dropbox-placeholder.test.ts`.
 * What is pinned HERE is the part only `publish` has: Submit and promote around
 * the commit, and the failure contract when the commit is refused.
 */

import { describe, it, expect, vi } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";
import {
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

/** The seeded Lessons sit at the default Priority band, P2. */
const ANNOUNCE_P2 = 2 as const;

/** A Course whose every Lesson has a hard gap, so the release ships no bytes. */
const syllabusOnlyCourse = async () => {
  const world = await setup({ videoCount: 2 });
  for (const video of world.videos) await world.unfilm(video.id);
  return world;
};

const receiptManifest = () => {
  const stored = fakeDropbox.get(
    `${DROPBOX_REMOTE_PATH}/test-course/course.json`
  );
  if (!stored) throw new Error("No course.json in fake Dropbox");
  return JSON.parse(stored.content.toString("utf-8"));
};

const isVideoUpload = (url: string, init: RequestInit) => {
  if (!url.includes("/2/files/upload") || url.includes("session")) return false;
  const arg = (init.headers as Record<string, string> | undefined)?.[
    "Dropbox-API-Arg"
  ];
  return Boolean(arg && JSON.parse(arg).path.endsWith(".mp4"));
};

describe("CoursePublishService — a syllabus-only release", () => {
  it("Submits, commits and promotes a release that ships no video at all", async () => {
    const { course, run } = await syllabusOnlyCourse();

    const stages: string[] = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc.publish({
          courseId: course.id,
          versionName: "v0.1",
          versionDescription: "The shape of the course",
          includeTodoLessons: true,
          placeholderFloor: ANNOUNCE_P2,
          onStageChange: (stage) => stages.push(stage),
        });
        const versionOps = yield* VersionOperationsService;
        return {
          outcome,
          versions: yield* versionOps.getCourseVersions(course.id),
        };
      })
    );

    // Nothing to encode, so no export phase — but the commit still happens.
    expect(stages).not.toContain("exporting");
    expect(stages).toContain("uploading");
    expect(stages).toContain("complete");

    // Promote: the Pending Version is Published and a fresh Draft stands.
    const published = result.versions.find(
      (version) => version.id === result.outcome.publishedVersionId
    );
    const draft = result.versions.find(
      (version) => version.id === result.outcome.newDraftVersionId
    );
    expect(published).toMatchObject({ name: "v0.1", commitState: "published" });
    expect(draft).toMatchObject({ name: "", commitState: "draft" });

    // The commit receipt is a syllabus: Sections and bare titles, no assets.
    const manifest = receiptManifest();
    expect(manifest.schemaVersion).toBe(4);
    const lessons = manifest.sections.flatMap(
      (section: any) => section.lessons
    );
    expect(lessons.map((lesson: any) => lesson.type)).toEqual([
      "placeholder",
      "placeholder",
    ]);
    expect(
      fakeDropbox.fetchCalls.filter((call) =>
        isVideoUpload(call.url, call.init)
      )
    ).toHaveLength(0);
  }, 30_000);

  it("commits an empty tree when every Lesson is withheld rather than announced", async () => {
    const { course, run } = await syllabusOnlyCourse();

    // No floor at all: nothing is announced, so the Section holds nothing
    // effective and is elided. The manifest is a Course with no Sections, and
    // that is still a release.
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc.publish({
          courseId: course.id,
          versionName: "v0.1",
          versionDescription: "Nothing announced",
          includeTodoLessons: true,
          placeholderFloor: ANNOUNCE_NOTHING,
        });
        const versionOps = yield* VersionOperationsService;
        return {
          outcome,
          versions: yield* versionOps.getCourseVersions(course.id),
        };
      })
    );

    expect(receiptManifest().sections).toEqual([]);
    expect(
      result.versions.find(
        (version) => version.id === result.outcome.publishedVersionId
      )
    ).toMatchObject({ commitState: "published" });
  }, 30_000);

  it("reclaims nothing rather than failing when there is no export pool", async () => {
    const { course, run } = await syllabusOnlyCourse();

    // An export no Course Version can reach. Garbage collection runs only
    // behind an export pool that had work, so a release with nothing to encode
    // reclaims nothing — and, crucially, does not fail trying.
    const stalePath = path.join(
      finishedVideosDir,
      `${course.id}-stale0000000000000000000000000000.mp4`
    );
    fs.writeFileSync(stalePath, "an export no Course Version can reach");

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.publish({
          courseId: course.id,
          versionName: "v0.1",
          versionDescription: "The shape of the course",
          includeTodoLessons: true,
          placeholderFloor: ANNOUNCE_P2,
        });
      })
    );

    expect(fs.existsSync(stalePath)).toBe(true);
    expect(receiptManifest().schemaVersion).toBe(4);
  }, 30_000);

  it("auto-Discards a refused commit and leaves the syllabus safe in the fresh Draft", async () => {
    const { course, run } = await syllabusOnlyCourse();

    // Refuse the one write that is the whole release: the receipt.
    const originalFetch = fakeDropbox.handleFetch;
    fakeDropbox.cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : String(url);
        const rawArg = (init?.headers as Record<string, string> | undefined)?.[
          "Dropbox-API-Arg"
        ];
        const apiArg = rawArg ? JSON.parse(rawArg) : {};
        if (
          urlStr.includes("/2/files/upload") &&
          !urlStr.includes("session") &&
          apiArg.path?.endsWith("/course.json") &&
          apiArg.mode === "overwrite"
        ) {
          return new Response(
            JSON.stringify({ error_summary: "too_many_write_operations/." }),
            { status: 409 }
          );
        }
        return originalFetch(url as any, init);
      })
    );

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc
          .publish({
            courseId: course.id,
            versionName: "v0.1",
            versionDescription: "The shape of the course",
            includeTodoLessons: true,
            placeholderFloor: ANNOUNCE_P2,
          })
          .pipe(
            Effect.catchTag("PublishCommitFailedError", (error) =>
              Effect.succeed({ error: true as const, errorDetails: error })
            )
          );
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        const draft = yield* versionOps.getVersionWithSections(
          (outcome as any).errorDetails.newDraftVersionId
        );
        return { outcome, versions, draft };
      })
    );

    expect(result.outcome).toMatchObject({
      error: true,
      errorDetails: { reason: "sync_failed" },
    });
    // The Pending Version was Discarded; one Draft remains.
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0]).toMatchObject({ commitState: "draft" });

    // The author's edits are safe: the freshly cloned Draft still holds every
    // Lesson of the syllabus that failed to land.
    const draftLessons = result.draft.sections.flatMap(
      (section: any) => section.lessons
    );
    expect(draftLessons).toHaveLength(2);
    expect(draftLessons.flatMap((lesson: any) => lesson.videos)).toHaveLength(
      2
    );
  }, 30_000);
});
