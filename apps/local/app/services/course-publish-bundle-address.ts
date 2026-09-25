/**
 * WHERE A BUNDLE LIVES — the one place a Bundle's address is computed.
 *
 * A Bundle is addressed by its RECIPE, not by its bytes: every ingredient is
 * database state or a pure derivation of it, so the destination path is known
 * before any encoding or reading happens — which is what lets export and upload
 * overlap. Two files at one address are asserted identical because they came
 * from identical Clips and Video Format; the Export Version Key is the manual
 * lever for invalidating that assertion (ADR 0023).
 *
 * Split out of `course-publish-dropbox.ts` so the address can be read — and
 * tested — on its own. What goes into the hash is a published decision; how the
 * upload uses it is not.
 */

import { createHash } from "node:crypto";
import type { PlaceholderFloor } from "@/packages/course-json";

export type BundleAddressInput = {
  /** The generated `course.schema.json` text — the manifest contract itself. */
  readonly schemaJson: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly courseName: string;
  /** Whether to-do Lessons ship. */
  readonly includeTodoLessons: boolean;
  /**
   * The Placeholder Floor. Belt and braces beside the to-do setting, for the
   * same reason (ADR 0023): the floor genuinely changes the shipped asset set,
   * because a Lesson holding one sound Video and one gapped Video becomes a
   * Placeholder Lesson and ships neither. The Videos below would move anyway,
   * but naming the control means two floor positions on one CourseVersion can
   * never collide at one address even if they happen to ship the same files.
   */
  readonly placeholderFloor: PlaceholderFloor;
  /** The raw Section tree of the Version being committed. */
  readonly sections: unknown;
  /** Each shipping Video's position in the Bundle plus its Export Hash. */
  readonly videos: readonly {
    readonly relativeAssetPath: string;
    readonly exportHash: string | null;
  }[];
};

export type BundleAddress = {
  /** `versions/{versionFingerprint}-{assetFingerprint}`, relative to the Course dir. */
  readonly assetBasePath: string;
};

export const computeBundleAddress = (
  input: BundleAddressInput
): BundleAddress => {
  const assetFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaJson: input.schemaJson,
        courseId: input.courseId,
        courseVersionId: input.courseVersionId,
        courseName: input.courseName,
        includeTodoLessons: input.includeTodoLessons,
        placeholderFloor: input.placeholderFloor,
        sections: input.sections,
        videos: input.videos.map((entry) => ({
          relativeAssetPath: entry.relativeAssetPath,
          exportHash: entry.exportHash,
        })),
      })
    )
    .digest("hex")
    .slice(0, 32);
  const versionFingerprint = createHash("sha256")
    .update(input.courseVersionId)
    .digest("hex")
    .slice(0, 16);
  return {
    assetBasePath: `versions/${versionFingerprint}-${assetFingerprint}`,
  };
};
