"use client";

export const handle = { fullscreen: true };

import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { buildTranscript } from "@/lib/transcript-builder";
import { Array as EffectArray, Console, Effect } from "effect";
import { data } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.write";
import path from "path";
import { FileSystem } from "@effect/platform";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { CoursePublishService } from "@/services/course-publish-service";
import { WritePage } from "@/features/article-writer/write-page";
import { useState, useEffect } from "react";

type FileMetadata = { path: string; size: number; defaultEnabled: boolean };

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  // Phase 1: Fast operations (DB queries + transcript building)
  const immediateData = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;
    const linkAuthOps = yield* LinkAuthOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const publishService = yield* CoursePublishService;
    const video = yield* videoOps.getVideoWithClipsById(videoId);
    const [globalLinks, videoExists] = yield* Effect.all(
      [linkAuthOps.getLinks(), publishService.isExported(video)],
      { concurrency: "unbounded" }
    );

    const lesson = video.lesson;

    const {
      indexedClips,
      transcript,
      wordCount: transcriptWordCount,
      sections: sectionsWithWordCount,
    } = buildTranscript(video.clips, video.chapters);

    if (!lesson) {
      const [nextVideoId, previousVideoId] = yield* Effect.all(
        [videoOps.getNextVideoId(video), videoOps.getPreviousVideoId(video)],
        { concurrency: "unbounded" }
      );
      return {
        publicData: {
          videoPath: video.path,
          videoExists,
          lessonPath: null,
          sectionPath: null,
          repoId: null,
          lessonId: null,
          fullPath: path.resolve(getStandaloneVideoFilePath(videoId)),
          nextVideoId,
          previousVideoId,
          isStandalone: true,
          transcript,
          transcriptWordCount,
          chapters: sectionsWithWordCount,
          indexedClips,
          links: globalLinks,
          courseStructure: null as null | {
            repoName: string;
            currentSectionPath: string;
            currentLessonPath: string;
            sections: {
              path: string;
              lessons: { path: string; description?: string }[];
            }[];
          },
          nextLessonWithoutVideo: null as null | {
            lessonId: string;
            lessonPath: string;
            sectionPath: string;
            hasExplainerFolder: boolean;
          },
          memory: "",
        },
        fsContext: {
          type: "standalone" as const,
          standaloneVideoDir: getStandaloneVideoFilePath(videoId),
        },
      };
    }

    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;
    const lessonFullPath = path.join(repo.filePath!, section.path, lesson.path);

    const [
      [nextVideoId, previousVideoId],
      nextLessonWithoutVideo,
      repoWithSections,
    ] = yield* Effect.all(
      [
        Effect.all(
          [videoOps.getNextVideoId(video), videoOps.getPreviousVideoId(video)],
          {
            concurrency: "unbounded",
          }
        ),
        videoOps.getNextLessonWithoutVideo(video),
        courseOps.getCourseStructureById(section.repoVersion.repoId),
      ],
      { concurrency: "unbounded" }
    );

    let nextLessonHasExplainerFolder = false;
    if (nextLessonWithoutVideo) {
      const explainerPath = `${nextLessonWithoutVideo.repoFilePath}/${nextLessonWithoutVideo.sectionPath}/${nextLessonWithoutVideo.lessonPath}/explainer`;
      nextLessonHasExplainerFolder = yield* fs.exists(explainerPath);
    }

    const matchingVersion = repoWithSections?.versions.find(
      (v) => v.id === section.repoVersion.id
    );
    const courseStructure = matchingVersion
      ? {
          repoName: repoWithSections!.name,
          currentSectionPath: section.path,
          currentLessonPath: lesson.path,
          sections: matchingVersion.sections.map((s) => ({
            path: s.path,
            lessons: s.lessons
              .filter((l) => l.fsStatus === "real")
              .map((l) => ({
                path: l.path,
                description: l.description || undefined,
              })),
          })),
        }
      : null;

    return {
      publicData: {
        videoPath: video.path,
        videoExists,
        lessonPath: lesson.path,
        sectionPath: section.path,
        repoId: section.repoVersion.repoId,
        lessonId: lesson.id,
        fullPath: lessonFullPath,
        nextVideoId,
        previousVideoId,
        isStandalone: false,
        transcript,
        transcriptWordCount,
        chapters: sectionsWithWordCount,
        indexedClips,
        links: globalLinks,
        courseStructure,
        nextLessonWithoutVideo: nextLessonWithoutVideo
          ? {
              lessonId: nextLessonWithoutVideo.lessonId,
              lessonPath: nextLessonWithoutVideo.lessonPath,
              sectionPath: nextLessonWithoutVideo.sectionPath,
              hasExplainerFolder: nextLessonHasExplainerFolder,
            }
          : null,
        memory: repoWithSections?.memory ?? "",
      },
      fsContext: {
        type: "lesson" as const,
        lessonFullPath,
      },
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );

  // Phase 2: Slow FS operations — started as a Promise but not awaited,
  // so the loader returns immediately with the fast data above.
  const filesPromise: Promise<FileMetadata[]> = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (immediateData.fsContext.type === "standalone") {
      const { standaloneVideoDir } = immediateData.fsContext;
      const dirExists = yield* fs.exists(standaloneVideoDir);
      if (!dirExists) return [];

      const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);
      return yield* Effect.forEach(
        filesInDirectory,
        (filename) => {
          return Effect.gen(function* () {
            const filePath = getStandaloneVideoFilePath(videoId, filename);
            const stat = yield* fs.stat(filePath);
            if (stat.type !== "File") return null;
            const extension = path.extname(filename).slice(1);
            return {
              path: filename,
              size: Number(stat.size),
              defaultEnabled: DEFAULT_CHECKED_EXTENSIONS.includes(extension),
            };
          });
        },
        { concurrency: "unbounded" }
      ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    }

    const { lessonFullPath } = immediateData.fsContext;
    const allFilesInDirectory = yield* fs
      .readDirectory(lessonFullPath, { recursive: true })
      .pipe(
        Effect.map((files) =>
          files.map((file) => path.join(lessonFullPath, file))
        )
      );

    const filteredFiles = allFilesInDirectory.filter((filePath) => {
      return !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
        filePath.includes(excludedDir)
      );
    });

    return yield* Effect.forEach(
      filteredFiles,
      (filePath) => {
        return Effect.gen(function* () {
          const stat = yield* fs.stat(filePath);
          if (stat.type !== "File") return null;
          const relativePath = path.relative(lessonFullPath, filePath);
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
        });
      },
      { concurrency: "unbounded" }
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
  }).pipe(runtimeLive.runPromise);

  return {
    ...immediateData.publicData,
    filesPromise,
  };
};

function WritePageWithDeferredFiles({
  videoId,
  loaderData,
}: {
  videoId: string;
  loaderData: Omit<Route.ComponentProps["loaderData"], "filesPromise"> & {
    filesPromise: Promise<FileMetadata[]>;
  };
}) {
  const { filesPromise, ...restData } = loaderData;
  const [files, setFiles] = useState<FileMetadata[]>([]);

  useEffect(() => {
    let cancelled = false;
    filesPromise
      .then((resolved) => {
        if (!cancelled) setFiles(resolved);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [filesPromise]);

  return <WritePage videoId={videoId} loaderData={{ ...restData, files }} />;
}

export function InnerComponent(props: Route.ComponentProps) {
  const { videoId } = props.params;
  return (
    <WritePageWithDeferredFiles
      videoId={videoId}
      loaderData={props.loaderData}
    />
  );
}

export default function Component(props: Route.ComponentProps) {
  return <InnerComponent {...props} key={props.params.videoId} />;
}
