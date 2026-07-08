"use client";

export const handle = { fullscreen: true };

import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader } from "@/services/route-action.server";
import { buildTranscript } from "@/lib/transcript-builder";
import { Array as EffectArray, Effect } from "effect";
type WriteRouteComponentProps = {
  params: { videoId: string };
  loaderData: any;
};
import path from "path";
import { FileSystem } from "@effect/platform";
import { DEFAULT_CHECKED_EXTENSIONS } from "@/services/text-writing-agent";
import { getVideoFilePath } from "@/services/video-files";
import { CoursePublishService } from "@/services/course-publish-service";
import { WritePage } from "@/features/article-writer/write-page";
import { useState, useEffect } from "react";

type FileMetadata = { path: string; size: number; defaultEnabled: boolean };

const loadWriteFiles = (lineageId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const videoDir = getVideoFilePath(lineageId);
    const dirExists = yield* fs.exists(videoDir);
    if (!dirExists) return [];

    const filesInDirectory = yield* fs.readDirectory(videoDir);
    return yield* Effect.forEach(
      filesInDirectory,
      (filename) =>
        Effect.gen(function* () {
          const filePath = getVideoFilePath(lineageId, filename);
          const stat = yield* fs.stat(filePath);
          if (stat.type !== "File") return null;
          const extension = path.extname(filename).slice(1);
          return {
            path: filename,
            size: Number(stat.size),
            defaultEnabled: DEFAULT_CHECKED_EXTENSIONS.includes(extension),
          };
        }),
      { concurrency: "unbounded" }
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
  });

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const courseOps = yield* CourseOperationsService;
      const linkAuthOps = yield* LinkAuthOperationsService;
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

        const filesPromise: Promise<FileMetadata[]> = runtimeLive.runPromise(
          loadWriteFiles(video.lineageId)
        );

        return {
          videoTitle: video.title,
          videoExists,
          lessonPath: null,
          sectionPath: null,
          repoId: null,
          lessonId: null,
          fullPath: path.resolve(getVideoFilePath(video.lineageId)),
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
          filesPromise,
        };
      }

      const section = lesson.section;

      const [
        [nextVideoId, previousVideoId],
        nextLessonWithoutVideo,
        repoWithSections,
      ] = yield* Effect.all(
        [
          Effect.all(
            [
              videoOps.getNextVideoId(video),
              videoOps.getPreviousVideoId(video),
            ],
            { concurrency: "unbounded" }
          ),
          videoOps.getNextLessonWithoutVideo(video),
          courseOps.getCourseStructureById(section.repoVersion.repoId),
        ],
        { concurrency: "unbounded" }
      );

      const matchingVersion = repoWithSections?.versions.find(
        (v) => v.id === section.repoVersion.id
      );
      const courseStructure = matchingVersion
        ? {
            repoName: repoWithSections!.name,
            currentSectionPath: section.title,
            currentLessonPath: lesson.title,
            sections: matchingVersion.sections.map((s) => ({
              path: s.title,
              lessons: s.lessons.map((l) => ({
                path: l.title,
                description: l.description || undefined,
              })),
            })),
          }
        : null;

      const filesPromise: Promise<FileMetadata[]> = runtimeLive.runPromise(
        loadWriteFiles(video.lineageId)
      );

      return {
        videoTitle: video.title,
        videoExists,
        lessonPath: lesson.title,
        sectionPath: section.title,
        repoId: section.repoVersion.repoId,
        lessonId: lesson.id,
        fullPath: path.resolve(getVideoFilePath(video.lineageId)),
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
              lessonPath: nextLessonWithoutVideo.lessonTitle,
              sectionPath: nextLessonWithoutVideo.sectionPath,
              hasExplainerFolder: false,
            }
          : null,
        memory: repoWithSections?.memory ?? "",
        filesPromise,
      };
    }),
});

function WritePageWithDeferredFiles({
  videoId,
  loaderData,
}: {
  videoId: string;
  loaderData: Record<string, unknown> & {
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

  return (
    <WritePage videoId={videoId} loaderData={{ ...restData, files } as any} />
  );
}

export function InnerComponent(props: WriteRouteComponentProps) {
  const { videoId } = props.params;
  return (
    <WritePageWithDeferredFiles
      videoId={videoId}
      loaderData={props.loaderData}
    />
  );
}

export default function Component(props: WriteRouteComponentProps) {
  return <InnerComponent {...props} key={props.params.videoId} />;
}
