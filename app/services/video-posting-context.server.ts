import { Effect, Array as EffectArray } from "effect";
import { FileSystem } from "@effect/platform";
import path from "path";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import {
  toTranscriptItems,
  formatProseTranscript,
  buildTranscript,
} from "@/lib/transcript-builder";
import { sortByOrder } from "@/lib/sort-by-order";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import type { CourseStructure } from "@/components/video-context-panel";

export interface VideoPostingContext {
  videoPath: string;
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

    if (!lesson) {
      const standaloneFiles = yield* loadStandaloneFiles(fs, videoId);
      return {
        videoPath: video.path,
        pitchId: video.pitchId ?? null,
        transcriptWordCount,
        chapters: sectionsWithWordCount,
        files: standaloneFiles,
        isStandalone: true,
        courseStructure: null as CourseStructure | null,
        links: globalLinks,
      } satisfies VideoPostingContext;
    }

    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;
    // Partial-slice fs-join: resolve the lesson's folder on read from
    // (title, rank) — "NN-section/NN.MM-lesson" — the caller owns repo.filePath.
    const relLessonDir = yield* versionOps.resolveLessonDir(lesson.id);
    const [currentSectionPath = "", currentLessonPath = ""] =
      relLessonDir.split("/");
    const lessonPath = path.join(repo.filePath!, relLessonDir);

    const [lessonFiles, courseStructure] = yield* Effect.all(
      [
        loadLessonFiles(fs, lessonPath),
        loadCourseStructure(
          courseOps,
          section.repoVersion.repoId,
          section.repoVersion.id,
          currentSectionPath,
          currentLessonPath
        ),
      ],
      { concurrency: "unbounded" }
    );

    return {
      videoPath: video.path,
      pitchId: video.pitchId ?? null,
      transcriptWordCount,
      chapters: sectionsWithWordCount,
      files: lessonFiles,
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

function loadStandaloneFiles(fs: FileSystem.FileSystem, videoId: string) {
  return Effect.gen(function* () {
    const standaloneVideoDir = getStandaloneVideoFilePath(videoId);
    const dirExists = yield* fs.exists(standaloneVideoDir);

    if (!dirExists) {
      return [] as Array<{
        path: string;
        size: number;
        defaultEnabled: boolean;
      }>;
    }

    const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);

    return yield* Effect.forEach(filesInDirectory, (filename) =>
      Effect.gen(function* () {
        const filePath = getStandaloneVideoFilePath(videoId, filename);
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

function loadLessonFiles(fs: FileSystem.FileSystem, lessonPath: string) {
  return Effect.gen(function* () {
    const allFilesInDirectory = yield* fs
      .readDirectory(lessonPath, { recursive: true })
      .pipe(
        Effect.map((files) => files.map((file) => path.join(lessonPath, file)))
      );

    const filteredFiles = allFilesInDirectory.filter(
      (filePath) =>
        !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
          filePath.includes(excludedDir)
        )
    );

    return yield* Effect.forEach(filteredFiles, (filePath) =>
      Effect.gen(function* () {
        const stat = yield* fs.stat(filePath);

        if (stat.type !== "File") {
          return null;
        }

        const relativePath = path.relative(lessonPath, filePath);
        const extension = path.extname(filePath).slice(1);

        const defaultEnabled =
          DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
          !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
            relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
          );

        return {
          path: relativePath,
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

    return {
      repoName: repoWithSections!.name,
      currentSectionPath,
      currentLessonPath,
      sections: matchingVersion.sections
        // Ghost sections derive no path; the posting UI only lists real ones.
        .filter((s) => s.lessons.some((l) => l.fsStatus === "real"))
        .map((s) => ({
          path: s.path,
          lessons: s.lessons
            .filter((l) => l.fsStatus === "real")
            .map((l) => ({
              path: l.path,
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
}

export const loadWriterContext = Effect.fn("loadWriterContext")(function* (
  videoId: string
) {
  const videoOps = yield* VideoOperationsService;
  const courseOps = yield* CourseOperationsService;
  const versionOps = yield* VersionOperationsService;
  const linkAuthOps = yield* LinkAuthOperationsService;
  const fs = yield* FileSystem.FileSystem;

  const [video, globalLinks] = yield* Effect.all(
    [videoOps.getVideoWithClipsById(videoId), linkAuthOps.getLinks()],
    { concurrency: "unbounded" }
  );

  const { indexedClips, transcript, wordCount, sections } = buildTranscript(
    video.clips,
    video.chapters
  );

  const lesson = video.lesson;

  if (!lesson) {
    const standaloneFiles = yield* loadStandaloneFiles(fs, videoId);
    return {
      transcript,
      transcriptWordCount: wordCount,
      indexedClips,
      memory: "",
      repoId: null,
      fullPath: path.resolve(getStandaloneVideoFilePath(videoId)),
      files: standaloneFiles,
      chapters: sections,
      isStandalone: true,
      courseStructure: null,
      links: globalLinks,
    } satisfies WriterContextData;
  }

  const repo = lesson.section.repoVersion.repo;
  const section = lesson.section;
  // Partial-slice fs-join: resolve the lesson's folder on read from (title, rank).
  const relLessonDir = yield* versionOps.resolveLessonDir(lesson.id);
  const [currentSectionPath = "", currentLessonPath = ""] =
    relLessonDir.split("/");
  const lessonPath = path.join(repo.filePath!, relLessonDir);

  const [lessonFiles, courseStructure, repoWithSections] = yield* Effect.all(
    [
      loadLessonFiles(fs, lessonPath),
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
    fullPath: lessonPath,
    files: lessonFiles,
    chapters: sections,
    isStandalone: false,
    courseStructure,
    links: globalLinks,
  } satisfies WriterContextData;
});
