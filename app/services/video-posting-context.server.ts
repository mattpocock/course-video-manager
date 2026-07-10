import { Effect, Array as EffectArray } from "effect";
import { FileSystem } from "@effect/platform";
import path from "path";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import {
  toTranscriptItems,
  formatProseTranscript,
  buildTranscript,
} from "@/lib/transcript-builder";
import { sortByOrder } from "@/lib/sort-by-order";
import { DEFAULT_CHECKED_EXTENSIONS } from "@/services/text-writing-agent";
import type { BeatKind } from "@/features/beats/beat-kinds";
import { getVideoFilePath } from "@/services/video-files";
import { projectVersionPaths } from "@/services/path-projection";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import type { CourseStructure } from "@/components/video-context-panel";

export interface VideoPostingContext {
  videoTitle: string;
  pitchId: string | null;
  transcriptWordCount: number;
  chapters: SectionWithWordCount[];
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  isStandalone: boolean;
  courseStructure: CourseStructure | null;
  links: Array<{
    id: string;
    title: string;
    url: string;
    description: string | null;
    createdAt: Date;
  }>;
}

export const loadVideoPostingContext = Effect.fn("loadVideoPostingContext")(
  function* (videoId: string) {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const linkAuthOps = yield* LinkAuthOperationsService;
    const fs = yield* FileSystem.FileSystem;

    const [video, globalLinks] = yield* Effect.all(
      [videoOps.getVideoWithClipsById(videoId), linkAuthOps.getLinks()],
      { concurrency: "unbounded" }
    );

    const items = toTranscriptItems(video.clips, video.chapters);
    const transcript = formatProseTranscript(items).trim();
    const transcriptWordCount = transcript ? transcript.split(/\s+/).length : 0;

    const sectionsWithWordCount = computeChapterWordCounts(
      video.clips,
      video.chapters
    );

    const lesson = video.lesson;
    const files = yield* loadVideoFiles(fs, video.lineageId);

    if (!lesson) {
      return {
        videoTitle: video.title,
        pitchId: video.pitchId ?? null,
        transcriptWordCount,
        chapters: sectionsWithWordCount,
        files,
        isStandalone: true,
        courseStructure: null as CourseStructure | null,
        links: globalLinks,
      } satisfies VideoPostingContext;
    }

    const section = lesson.section;
    const relLessonDir = yield* versionOps.resolveLessonDir(lesson.id);
    const [currentSectionPath = "", currentLessonPath = ""] =
      relLessonDir.split("/");

    const courseStructure = yield* loadCourseStructure(
      courseOps,
      section.repoVersion.repoId,
      section.repoVersion.id,
      currentSectionPath,
      currentLessonPath
    );

    return {
      videoTitle: video.title,
      pitchId: video.pitchId ?? null,
      transcriptWordCount,
      chapters: sectionsWithWordCount,
      files,
      isStandalone: false,
      courseStructure,
      links: globalLinks,
    } satisfies VideoPostingContext;
  }
);

function computeChapterWordCounts(
  clips: readonly { order: string; text: string | null }[],
  chapters: readonly { id: string; order: string; name: string }[]
): SectionWithWordCount[] {
  type ClipItem = { type: "clip"; order: string; text: string | null };
  type ChapterItem = {
    type: "chapter";
    order: string;
    id: string;
    name: string;
  };

  const sortedItems = sortByOrder<ClipItem | ChapterItem>([
    ...clips.map(
      (clip): ClipItem => ({ type: "clip", order: clip.order, text: clip.text })
    ),
    ...chapters.map(
      (ch): ChapterItem => ({
        type: "chapter",
        order: ch.order,
        id: ch.id,
        name: ch.name,
      })
    ),
  ]);

  const sections: SectionWithWordCount[] = [];
  let currentSectionIndex = -1;

  for (const item of sortedItems) {
    if (item.type === "chapter") {
      currentSectionIndex = sections.length;
      sections.push({
        id: item.id,
        name: item.name,
        order: item.order,
        wordCount: 0,
      });
    } else if (item.text && currentSectionIndex >= 0) {
      sections[currentSectionIndex]!.wordCount += item.text.split(/\s+/).length;
    }
  }

  return sections;
}

function loadVideoFiles(fs: FileSystem.FileSystem, lineageId: string) {
  return Effect.gen(function* () {
    const videoDir = getVideoFilePath(lineageId);
    const dirExists = yield* fs.exists(videoDir);

    if (!dirExists) {
      return [] as Array<{
        path: string;
        size: number;
        defaultEnabled: boolean;
      }>;
    }

    const filesInDirectory = yield* fs.readDirectory(videoDir);

    return yield* Effect.forEach(filesInDirectory, (filename) =>
      Effect.gen(function* () {
        const filePath = getVideoFilePath(lineageId, filename);
        const stat = yield* fs.stat(filePath);

        if (stat.type !== "File") {
          return null;
        }

        const extension = path.extname(filename).slice(1);
        const defaultEnabled = DEFAULT_CHECKED_EXTENSIONS.includes(extension);

        return {
          path: filename,
          size: Number(stat.size),
          defaultEnabled,
        };
      })
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
  });
}

function loadCourseStructure(
  courseOps: CourseOperationsService,
  repoId: string,
  versionId: string,
  currentSectionPath: string,
  currentLessonPath: string
) {
  return Effect.gen(function* () {
    const repoWithSections = yield* courseOps.getCourseStructureById(repoId);
    const matchingVersion = repoWithSections?.versions.find(
      (v) => v.id === versionId
    );

    if (!matchingVersion) {
      return null;
    }

    const derivedPaths = projectVersionPaths(matchingVersion.sections);

    return {
      repoName: repoWithSections!.name,
      currentSectionPath,
      currentLessonPath,
      sections: matchingVersion.sections.map((s) => ({
        path: derivedPaths.get(s.id) ?? s.title,
        lessons: s.lessons.map((l) => ({
          path: derivedPaths.get(l.id) ?? l.title,
          description: l.description || undefined,
        })),
      })),
    } satisfies CourseStructure;
  });
}

export interface WriterContextData {
  transcript: string;
  transcriptWordCount: number;
  indexedClips: Array<{
    index: number;
    sourceStartTime: number;
    sourceEndTime: number;
    videoFilename: string;
    text: string | null;
  }>;
  memory: string;
  repoId: string | null;
  fullPath: string;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  chapters: SectionWithWordCount[];
  isStandalone: boolean;
  courseStructure: CourseStructure | null;
  links: Array<{
    id: string;
    title: string;
    url: string;
    description: string | null;
    createdAt: Date;
  }>;
  beats: Array<{
    kind: BeatKind;
    title: string;
    description: string;
  }>;
}

export const loadWriterContext = Effect.fn("loadWriterContext")(function* (
  videoId: string
) {
  const videoOps = yield* VideoOperationsService;
  const courseOps = yield* CourseOperationsService;
  const versionOps = yield* VersionOperationsService;
  const linkAuthOps = yield* LinkAuthOperationsService;
  const beatOps = yield* BeatOperationsService;
  const fs = yield* FileSystem.FileSystem;

  const [video, globalLinks, rawBeats] = yield* Effect.all(
    [
      videoOps.getVideoWithClipsById(videoId),
      linkAuthOps.getLinks(),
      beatOps.listBeatsByVideoId(videoId),
    ],
    { concurrency: "unbounded" }
  );

  const beats = rawBeats.map((b) => ({
    kind: b.kind as BeatKind,
    title: b.title,
    description: b.description ?? "",
  }));

  const { indexedClips, transcript, wordCount, sections } = buildTranscript(
    video.clips,
    video.chapters
  );

  const lesson = video.lesson;
  const files = yield* loadVideoFiles(fs, video.lineageId);
  const fullPath = path.resolve(getVideoFilePath(video.lineageId));

  if (!lesson) {
    return {
      transcript,
      transcriptWordCount: wordCount,
      indexedClips,
      memory: "",
      repoId: null,
      fullPath,
      files,
      chapters: sections,
      isStandalone: true,
      courseStructure: null,
      links: globalLinks,
      beats,
    } satisfies WriterContextData;
  }

  const section = lesson.section;
  const relLessonDir = yield* versionOps.resolveLessonDir(lesson.id);
  const [currentSectionPath = "", currentLessonPath = ""] =
    relLessonDir.split("/");

  const [courseStructure, repoWithSections] = yield* Effect.all(
    [
      loadCourseStructure(
        courseOps,
        section.repoVersion.repoId,
        section.repoVersion.id,
        currentSectionPath,
        currentLessonPath
      ),
      courseOps.getCourseStructureById(section.repoVersion.repoId),
    ],
    { concurrency: "unbounded" }
  );

  return {
    transcript,
    transcriptWordCount: wordCount,
    indexedClips,
    memory: repoWithSections?.memory ?? "",
    repoId: section.repoVersion.repoId,
    fullPath,
    files,
    chapters: sections,
    isStandalone: false,
    courseStructure,
    links: globalLinks,
    beats,
  } satisfies WriterContextData;
});
