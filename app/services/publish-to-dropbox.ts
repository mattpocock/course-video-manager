import { Data, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import path from "node:path";

export class DoesNotExistOnDbError extends Data.TaggedError(
  "DoesNotExistOnDbError"
)<{
  type: "section" | "lesson";
  path: string;
  message: string;
}> {}

type DbSection = {
  id: string;
  path: string;
  lessons: DbLesson[];
};

type DbLesson = {
  id: string;
  path: string;
  videos: DbVideo[];
};

type DbVideo = {
  id: string;
  title: string;
};

export type ResolvedVideo = {
  id: string;
  absolutePath: string;
  name: string;
};

export type ResolvedLesson = {
  id: string;
  path: string;
  videos: ResolvedVideo[];
};

export type ResolvedSection = {
  id: string;
  path: string;
  lessons: ResolvedLesson[];
};

export type MissingVideo = {
  videoId: string;
  videoTitle: string;
  lessonPath: string;
};

export type ResolveResult = {
  sections: ResolvedSection[];
  missingVideos: MissingVideo[];
};

export const resolveSectionsWithVideos = (opts: {
  sectionsInDb: DbSection[];
  finishedVideosDirectory: string;
  videoPathOverrides?: Map<string, string>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const sections: ResolvedSection[] = [];
    const missingVideos: MissingVideo[] = [];

    for (const sectionInDb of opts.sectionsInDb) {
      const lessons: ResolvedLesson[] = [];

      for (const lessonInDb of sectionInDb.lessons) {
        const videos: ResolvedVideo[] = [];

        for (const video of lessonInDb.videos) {
          const absolutePath =
            opts.videoPathOverrides?.get(video.id) ??
            path.join(opts.finishedVideosDirectory, video.id + ".mp4");

          if (yield* fs.exists(absolutePath)) {
            videos.push({
              id: video.id,
              absolutePath,
              name: video.title,
            });
          } else {
            missingVideos.push({
              videoId: video.id,
              videoTitle: video.title,
              lessonPath: lessonInDb.path,
            });
          }
        }

        lessons.push({
          id: lessonInDb.id,
          path: lessonInDb.path,
          videos,
        });
      }

      sections.push({
        id: sectionInDb.id,
        path: sectionInDb.path,
        lessons,
      });
    }

    return { sections, missingVideos };
  });

export type Chapter = {
  title: string;
  startTime: number;
};

type ChapterClip = {
  order: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

type ChapterSection = {
  order: string;
  name: string;
};

export const buildChapters = (
  clips: ChapterClip[],
  chapters: ChapterSection[]
): Chapter[] | null => {
  type Item =
    | { kind: "clip"; order: string; duration: number }
    | { kind: "section"; order: string; name: string };

  const items: Item[] = [
    ...clips.map(
      (c): Item => ({
        kind: "clip",
        order: c.order,
        duration: c.sourceEndTime - c.sourceStartTime,
      })
    ),
    ...chapters.map(
      (s): Item => ({ kind: "section", order: s.order, name: s.name })
    ),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  let elapsed = 0;
  const raw: Chapter[] = [];
  for (const item of items) {
    if (item.kind === "clip") {
      elapsed += item.duration;
    } else {
      raw.push({ title: item.name, startTime: Math.floor(elapsed) });
    }
  }

  const totalSeconds = Math.floor(elapsed);
  const kept: Chapter[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = i + 1 < raw.length ? raw[i + 1]!.startTime : totalSeconds;
    if (raw[i]!.startTime < next) {
      kept.push(raw[i]!);
    }
  }

  if (kept.length === 0) return null;

  if (kept[0]!.startTime > 0) {
    kept.unshift({ title: "Intro", startTime: 0 });
  }

  return kept;
};
