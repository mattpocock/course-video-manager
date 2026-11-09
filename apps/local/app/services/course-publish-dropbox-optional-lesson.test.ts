/**
 * The Optional Lesson through a real Dropbox commit: the Lesson's `optional`
 * column reaches the published manifest as `"optional": true`, in a version 5
 * manifest beside the version 5 sidecar. A Course with no Optional Lesson is
 * held at version 4 by course-publish-dropbox-text-lesson.test.ts.
 */

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { buildCourseJsonSchema } from "@/packages/course-json";
import { lessons as lessonsTable, videos as videosTable } from "@/db/schema";
import {
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  receiptManifest,
  setupDropboxUploadTests,
  setupUploads,
  testDb,
  videoUploadCount,
} from "./course-publish-dropbox-upload-test-setup";

setupDropboxUploadTests();

describe("Dropbox publish — Optional Lessons", () => {
  it('publishes "optional": true on the Optional Lesson only, in a v5 manifest', async () => {
    const { videos, sync } = await setupUploads({ videoCount: 2 });
    const [video] = await testDb
      .select({ lessonId: videosTable.lessonId })
      .from(videosTable)
      .where(eq(videosTable.id, videos[0]!.id));
    await testDb
      .update(lessonsTable)
      .set({ optional: true })
      .where(eq(lessonsTable.id, video!.lessonId!));

    await sync();

    const manifest = receiptManifest();
    const lessons = manifest.sections.flatMap((section) => section.lessons);
    expect(lessons.map((lesson) => "optional" in lesson)).toEqual([
      true,
      false,
    ]);
    expect((lessons[0] as { optional?: boolean } | undefined)?.optional).toBe(
      true
    );
    expect(manifest.schemaVersion).toBe(5);
    expect(
      fakeDropbox
        .get(`${DROPBOX_REMOTE_PATH}/test-course/${manifest.$schema}`)
        ?.content.toString("utf-8")
    ).toBe(JSON.stringify(buildCourseJsonSchema(5), null, 2));
    // Optional changes completion, not what ships.
    expect(videoUploadCount()).toBe(2);
  });
});
