import { Data, Effect } from "effect";
import {
  computeExportHash,
  toExportClips,
  type ExportOverlay,
} from "@/services/export-hash";
import {
  computeEffectiveSections,
  computeShippingSections,
} from "./effective-sections";
import {
  classifyLessonPublishStatus,
  type PlaceholderFloor,
} from "./lesson-publish-status";
import {
  CourseJsonVideo,
  CourseJsonLessonSchema,
  CourseJsonSectionSchema,
  type CourseJsonDocument,
} from "./course-json-schema";
import {
  computeLessonWarnings,
  deriveVideoRole,
} from "@/services/lesson-warnings";
import { buildChapters } from "@/services/publish-to-dropbox";

// ── Publish blockers ──────────────────────────────────────────────────────

// A Lesson whose active Videos don't form a valid role combo (a lone solution,
// an explainer beside a problem, duplicate roles, 3+ videos, …). We can't tell
// which Video is the problem vs solution, so the whole Lesson is flagged.
export type InvalidLessonCombo = {
  sectionPath: string;
  lessonPath: string;
  videoTitles: string[];
};

// What a shipping Video is missing to be publishable. A Video that reaches
// course.json must carry exportable clips (so it produces an .mp4 and an Export
// Hash) and both a body and a description — each is required, never nullable.
// Any absence is a gap on our side, not real optionality.
//
// Only a Lesson that SHIPS is gap-checked. A hard gap — no Clips, no `body` —
// decides the Lesson's Lesson Publish Status instead of appearing here, so in
// practice the only gap left on a shipping Video is a missing `description`,
// which Autofill writes. That one is reported to the publish page AND refuses
// the build (see IncompleteShippingVideoError): a missing `description` can
// never be announced, because it is not a hard gap, so the only honest
// alternative to refusing is a `null` in the manifest.
export type IncompleteVideo = {
  sectionPath: string;
  lessonPath: string;
  videoTitle: string;
  missing: Array<"clips" | "body" | "description">;
};

// Everything wrong with the Lessons that SHIP, enumerated in full. The
// pre-publish page reads this to warn (and block) before a doomed publish is
// ever started, and `buildCourseJson` refuses on either list (ADR 0029): a
// Lesson that does not ship in full is silent here, and one that does must be
// whole.
export type PublishBlockers = {
  invalidLessonCombos: InvalidLessonCombo[];
  incompleteVideos: IncompleteVideo[];
};

// ── Errors ──────────────────────────────────────────────────────────────

export class InvalidLessonRoleComboError extends Data.TaggedError(
  "InvalidLessonRoleComboError"
)<InvalidLessonCombo> {}

// A shipping Video that is not whole. NARROWER than the retired
// `IncompleteVideosError` it replaces (ADR 0029): a HARD GAP — no active Video,
// no Clips, no `body` — decides the Lesson's Lesson Publish Status instead of
// reaching here, so the Lesson ships as a Placeholder Lesson or is withheld and
// is listed on the publish page rather than throwing.
//
// What is left is a shipping Video missing its `description`, and that one has
// to refuse the release. A missing `description` is NOT a hard gap (Autofill
// writes it), so no floor position can announce the Lesson instead — and the
// schema types the field as a string. Refusing here rather than in the publish
// page's lint gate is what makes the guarantee hold on EVERY path into a
// manifest, including the standalone Dropbox re-sync, which runs no lint gate
// and would otherwise overwrite the live course.json with `"description": null`.
export class IncompleteShippingVideoError extends Data.TaggedError(
  "IncompleteShippingVideoError"
)<IncompleteVideo> {}

export class MissingVideoAssetReceiptError extends Data.TaggedError(
  "MissingVideoAssetReceiptError"
)<{
  videoId: string;
}> {}

export class InvalidVideoAssetReceiptError extends Data.TaggedError(
  "InvalidVideoAssetReceiptError"
)<{
  videoId: string;
}> {}

// ── Input types ─────────────────────────────────────────────────────────

type InputClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: string;
  zoomType: string;
  order: string;
  overlays: ExportOverlay[];
};

type InputChapter = {
  order: string;
  name: string;
};

type InputVideo = {
  id: string;
  lineageId: string;
  title: string;
  body: string | null;
  description: string | null;
  archived: boolean;
  format: string;
  clips: InputClip[];
  chapters: InputChapter[];
};

type InputLesson = {
  lineageId: string;
  path: string;
  title: string;
  description: string;
  authoringStatus: string | null;
  // The Lesson Priority band the Placeholder Floor is compared against.
  priority: number;
  videos: InputVideo[];
};

type InputSection = {
  lineageId: string;
  path: string;
  title: string;
  description: string;
  lessons: InputLesson[];
};

export type VideoAssetReceipt = {
  sha256: string;
  bytes: number;
};

export type BuildCourseJsonInput = {
  courseId: string;
  courseVersionId: string;
  courseName: string;
  assetBasePath: string;
  sections: InputSection[];
  videoAssets: ReadonlyMap<string, VideoAssetReceipt>;
  // Whether Lessons still marked to-do ship in this manifest. When false, every
  // to-do Lesson is withheld — omitted from course.json entirely, and Sections
  // left with no shippable Lessons disappear.
  includeTodoLessons: boolean;
  // The lowest Lesson Priority band whose unshippable Lessons are announced as
  // Placeholder Lessons. `ANNOUNCE_NOTHING` reproduces the pre-ADR-0029
  // release exactly: every unshippable Lesson is withheld.
  placeholderFloor: PlaceholderFloor;
};

// ── Publish-blocker detection ─────────────────────────────────────────────

// The gaps that make a Video unshippable — no exportable clips, no body, or no
// description. An empty result means the Video is complete and may be emitted.
// This is the single gate that lets `toVideoEntry` treat every field as present.
function videoGaps(video: InputVideo): IncompleteVideo["missing"] {
  const missing: IncompleteVideo["missing"] = [];
  if (video.clips.length === 0) missing.push("clips");
  // Blank is absent, for both fields: an empty string is what the
  // `missingBody` / `missingDescription` lints read as missing, and what the
  // `no-body` hard gap reads as missing, so nothing here may read it as text.
  if (!video.body?.trim()) missing.push("body");
  if (!video.description?.trim()) missing.push("description");
  return missing;
}

// Which Video plays which role in a Lesson. Assumes the active Videos already
// form a valid combo (i.e. `computeLessonWarnings` returned nothing) — the same
// selection the builder and the blocker collector both rely on, so they agree.
type SelectedLessonVideos =
  | { type: "explainer"; video: InputVideo }
  | { type: "problem"; problem: InputVideo; solution?: InputVideo };

function selectLessonVideos(
  activeVideos: readonly InputVideo[]
): SelectedLessonVideos {
  const roleMap = activeVideos.map((v) => ({
    video: v,
    role: deriveVideoRole(v.title),
  }));
  const problem = roleMap.find((r) => r.role === "problem");
  const solution = roleMap.find((r) => r.role === "solution");
  const explainer = roleMap.find((r) => r.role === "explainer");

  if (problem) {
    return {
      type: "problem",
      problem: problem.video,
      solution: solution?.video,
    };
  }
  return { type: "explainer", video: explainer?.video ?? activeVideos[0]! };
}

// The Videos a Lesson actually ships, in course.json order.
function shippingVideos(selected: SelectedLessonVideos): InputVideo[] {
  return selected.type === "problem"
    ? [selected.problem, ...(selected.solution ? [selected.solution] : [])]
    : [selected.video];
}

// The single source of truth for "what is wrong with what ships?". Walks the
// SHIPPING output — the exact Lessons and Videos this publish would ship in full
// — and returns every blocker: Lessons with an invalid role combo, and shipping
// Videos missing a required field. A Lesson that does not ship is silent here,
// because a Placeholder Lesson's half-planned Video must not refuse a
// pre-launch release (ADR 0029); it is reported as its Lesson Publish Status
// instead. The shipping walk needs no floor — see computeShippingSections.
export const collectPublishBlockers = (
  sections: readonly InputSection[],
  includeTodoLessons: boolean
): PublishBlockers => {
  const invalidLessonCombos: InvalidLessonCombo[] = [];
  const incompleteVideos: IncompleteVideo[] = [];

  const shippingSections = computeShippingSections(
    sections,
    includeTodoLessons
  );

  for (const section of shippingSections) {
    for (const lesson of section.lessons) {
      const activeVideos = lesson.videos.filter((v) => !v.archived);
      if (activeVideos.length === 0) continue;

      // An invalid combo makes roles ambiguous, so we can't meaningfully gap-check
      // the individual Videos — flag the Lesson and move on.
      if (computeLessonWarnings({ videos: activeVideos }).length > 0) {
        invalidLessonCombos.push({
          sectionPath: section.path,
          lessonPath: lesson.path,
          videoTitles: activeVideos.map((v) => v.title),
        });
        continue;
      }

      for (const video of shippingVideos(selectLessonVideos(activeVideos))) {
        const missing = videoGaps(video);
        if (missing.length > 0) {
          incompleteVideos.push({
            sectionPath: section.path,
            lessonPath: lesson.path,
            videoTitle: video.title,
            missing,
          });
        }
      }
    }
  }

  return { invalidLessonCombos, incompleteVideos };
};

// ── Builder ─────────────────────────────────────────────────────────────

// The published .mp4 lives under the manifest's immutable assetBasePath, then
// section-dir/lesson-dir/video-title.mp4. Only a Video on a Lesson that SHIPS
// reaches here, so its clips (hence hash) and its body are guaranteed present
// by the classifier — those are two of the three hard gaps — and its
// `description` by the `IncompleteShippingVideoError` gate at the top of
// `buildCourseJson`, which has already refused this build if any shipping Video
// lacks one. Every emitted field is therefore non-null: ADR 0019's no-null rule
// for a shipping Video survives ADR 0029 intact.
function toVideoEntry(
  video: InputVideo,
  sectionPath: string,
  lessonPath: string,
  assetBasePath: string,
  asset: VideoAssetReceipt
): typeof CourseJsonVideo.Type {
  const exportClips = toExportClips(video.clips);
  return {
    id: video.lineageId,
    relativePath: `${assetBasePath}/${sectionPath}/${lessonPath}/${video.title}.mp4`,
    body: video.body!,
    description: video.description!,
    hash: computeExportHash(exportClips, video.format)!,
    sha256: asset.sha256,
    bytes: asset.bytes,
    chapters: buildChapters(video.clips, video.chapters) ?? [],
  };
}

export const buildCourseJson = (
  input: BuildCourseJsonInput
): Effect.Effect<
  CourseJsonDocument,
  | InvalidLessonRoleComboError
  | IncompleteShippingVideoError
  | MissingVideoAssetReceiptError
  | InvalidVideoAssetReceiptError
> =>
  Effect.gen(function* () {
    // THE ONE GATE EVERY PATH INTO A MANIFEST PASSES THROUGH. The pre-publish
    // page reads the exact same blockers, so a doomed publish is refused before
    // it starts; this is what makes the guarantee hold anyway on a path that
    // never asked the page — the standalone Dropbox re-sync. We fail on the
    // first of either list, matching the page, which blocks publish until it is
    // fixed.
    //
    // An invalid role combo makes roles ambiguous, so there is no honest node
    // to emit. An incomplete shipping Video is narrower than it was before ADR
    // 0029: a hard gap decides a Lesson Publish Status instead of arriving
    // here, so what is left is a missing `description` — which the schema types
    // as a string and which no floor can announce its way out of.
    const blockers = collectPublishBlockers(
      input.sections,
      input.includeTodoLessons
    );
    if (blockers.invalidLessonCombos.length > 0) {
      return yield* new InvalidLessonRoleComboError(
        blockers.invalidLessonCombos[0]!
      );
    }
    if (blockers.incompleteVideos.length > 0) {
      return yield* new IncompleteShippingVideoError(
        blockers.incompleteVideos[0]!
      );
    }

    const sections: Array<typeof CourseJsonSectionSchema.Type> = [];
    const makeVideoEntry = Effect.fn("makeCourseJsonVideoEntry")(function* (
      video: InputVideo,
      sectionPath: string,
      lessonPath: string
    ) {
      const asset = input.videoAssets.get(video.id);
      if (!asset) {
        return yield* new MissingVideoAssetReceiptError({ videoId: video.id });
      }
      if (
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0
      ) {
        return yield* new InvalidVideoAssetReceiptError({ videoId: video.id });
      }
      return toVideoEntry(
        video,
        sectionPath,
        lessonPath,
        input.assetBasePath,
        asset
      );
    });

    // The effective-output filter is the single home of "what this release
    // reaches": the Lessons that ship in full plus the Lessons announced as
    // Placeholder Lessons. Withheld Lessons and Sections left with nothing are
    // already gone. The classifier is then asked once more, per Lesson, for
    // which of the two this one is — the same pure verdict the filter used, so
    // the tree and the nodes can never disagree.
    const effectiveSections = computeEffectiveSections(
      input.sections,
      input.includeTodoLessons,
      input.placeholderFloor
    );

    for (const section of effectiveSections) {
      const lessons: Array<typeof CourseJsonLessonSchema.Type> = [];

      for (const lesson of section.lessons) {
        const verdict = classifyLessonPublishStatus(lesson, {
          includeTodoLessons: input.includeTodoLessons,
          placeholderFloor: input.placeholderFloor,
        });

        // A PLACEHOLDER LESSON: a title and nothing else. No video key, no
        // `body`, no `description` — there is nothing filmed to describe. The
        // `id` is the Lesson's lineage id, exactly as on a shipping node, so
        // filling the Lesson in later updates one resource downstream rather
        // than creating a second.
        if (verdict.status === "placeholder") {
          lessons.push({
            type: "placeholder",
            id: lesson.lineageId,
            title: lesson.title,
          });
          continue;
        }

        const activeVideos = lesson.videos.filter((v) => !v.archived);
        if (activeVideos.length === 0) continue;

        const selected = selectLessonVideos(activeVideos);
        if (selected.type === "problem") {
          if (selected.solution) {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: yield* makeVideoEntry(
                selected.problem,
                section.path,
                lesson.path
              ),
              solution: yield* makeVideoEntry(
                selected.solution,
                section.path,
                lesson.path
              ),
            });
          } else {
            lessons.push({
              type: "problem",
              id: lesson.lineageId,
              title: lesson.title,
              problem: yield* makeVideoEntry(
                selected.problem,
                section.path,
                lesson.path
              ),
            });
          }
        } else {
          lessons.push({
            type: "explainer",
            id: lesson.lineageId,
            title: lesson.title,
            explainer: yield* makeVideoEntry(
              selected.video,
              section.path,
              lesson.path
            ),
          });
        }
      }

      // Emit a Section only when this release actually carries Lessons in it.
      // Sections are decided by their Lessons, not by a derived path — a
      // Section with nothing effective (whether it never had Lessons or had
      // them all withheld/archived upstream) produces no course.json entry,
      // never an empty lessons array. A Section whose every Lesson is a
      // Placeholder Lesson DOES ship: that is a whole unfilmed part of the
      // Course appearing in the syllabus.
      if (lessons.length === 0) continue;

      sections.push({
        id: section.lineageId,
        title: section.title,
        lessons,
      });
    }

    return {
      $schema: `${input.assetBasePath}/course.schema.json`,
      schemaVersion: 4 as const,
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      archiveTTL: "90d" as const,
      courseName: input.courseName,
      sections,
    };
  });
