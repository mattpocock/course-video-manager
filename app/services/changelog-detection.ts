import type { TranscriptItem } from "@/lib/transcript-builder";
import { toDiffArray } from "@/lib/transcript-builder";

export type VersionWithStructure = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  sections: Array<{
    id: string;
    path: string;
    previousVersionSectionId: string | null;
    lessons: Array<{
      id: string;
      path: string;
      previousVersionLessonId: string | null;
      authoringStatus: "todo" | "done" | null;
      videos: Array<{
        id: string;
        title: string;
        transcript: TranscriptItem[];
      }>;
    }>;
  }>;
};

type Lesson = VersionWithStructure["sections"][number]["lessons"][number];
type VideoEntry = Lesson["videos"][number];

export type VideoChange =
  | {
      type: "updated";
      videoTitle: string;
      oldClips: string[];
      newClips: string[];
    }
  | { type: "new"; videoTitle: string }
  | { type: "deleted"; videoTitle: string };

export type VersionChanges = {
  newLessons: Array<{
    sectionPath: string;
    lessonPath: string;
    videoTitles: string[];
    authoringStatus: "todo" | "done" | null;
  }>;
  renamedSections: Array<{ oldPath: string; newPath: string }>;
  renamedLessons: Array<{
    sectionPath: string;
    oldPath: string;
    newPath: string;
  }>;
  updatedLessons: Array<{
    sectionPath: string;
    lessonPath: string;
    videoChanges: VideoChange[];
  }>;
  markedReady: Array<{ sectionPath: string; lessonPath: string }>;
  markedTodo: Array<{ sectionPath: string; lessonPath: string }>;
  deletedSections: Array<{ sectionPath: string }>;
  deletedLessons: Array<{
    sectionPath: string;
    lessonPath: string;
    videoTitles: string[];
  }>;
};

function videoHasClipContent(video: VideoEntry): boolean {
  return video.transcript.some((item) => item.type === "clip");
}

function lessonHasContent(lesson: Lesson): boolean {
  return lesson.videos.some(videoHasClipContent);
}

type VideoData = { videoTitle: string; diffArray: string[] };

type LessonLookupEntry = {
  sectionPath: string;
  lessonPath: string;
  lesson: Lesson;
  videosByTitle: Map<string, VideoData>;
};

function buildLessonLookup(
  version: VersionWithStructure
): Map<string, LessonLookupEntry> {
  const lookup = new Map<string, LessonLookupEntry>();
  for (const section of version.sections) {
    for (const lesson of section.lessons) {
      const videosByTitle = new Map<string, VideoData>();
      for (const video of lesson.videos) {
        videosByTitle.set(video.title, {
          videoTitle: video.title,
          diffArray: toDiffArray(video.transcript).map((line) => line.trim()),
        });
      }
      lookup.set(lesson.id, {
        sectionPath: section.path,
        lessonPath: lesson.path,
        lesson,
        videosByTitle,
      });
    }
  }
  return lookup;
}

function getVideosWithContent(lesson: Lesson): string[] {
  return lesson.videos.filter(videoHasClipContent).map((v) => v.title);
}

function detectVideoChanges(
  currentLesson: Lesson,
  prevEntry: LessonLookupEntry
): VideoChange[] {
  const changes: VideoChange[] = [];
  const currentVideosByTitle = new Map<string, string[]>();
  for (const video of currentLesson.videos) {
    currentVideosByTitle.set(
      video.title,
      toDiffArray(video.transcript).map((line) => line.trim())
    );
  }

  for (const [videoTitle, currentItems] of currentVideosByTitle) {
    const prevVideo = prevEntry.videosByTitle.get(videoTitle);
    if (!prevVideo || prevVideo.diffArray.length === 0) {
      if (currentItems.length > 0) {
        changes.push({ type: "new", videoTitle });
      }
    } else if (currentItems.length === 0) {
      changes.push({ type: "deleted", videoTitle });
    } else {
      const oldJoined = prevVideo.diffArray.join(" ");
      const newJoined = currentItems.join(" ");
      if (oldJoined !== newJoined) {
        changes.push({
          type: "updated",
          videoTitle,
          oldClips: prevVideo.diffArray,
          newClips: currentItems,
        });
      }
    }
  }

  for (const [videoTitle, prevVideo] of prevEntry.videosByTitle) {
    if (
      !currentVideosByTitle.has(videoTitle) &&
      prevVideo.diffArray.length > 0
    ) {
      changes.push({ type: "deleted", videoTitle });
    }
  }

  return changes;
}

function buildSectionLookup(
  version: VersionWithStructure
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const section of version.sections) {
    lookup.set(section.id, section.path);
  }
  return lookup;
}

function stripNumericPrefix(path: string): string {
  return path.replace(/^[\d.]+-/, "");
}

function hasNameChanged(oldPath: string, newPath: string): boolean {
  return stripNumericPrefix(oldPath) !== stripNumericPrefix(newPath);
}

export function detectChanges(
  currentVersion: VersionWithStructure,
  previousVersion: VersionWithStructure | undefined
): VersionChanges | null {
  if (!previousVersion) {
    return null;
  }

  const changes: VersionChanges = {
    newLessons: [],
    renamedSections: [],
    renamedLessons: [],
    updatedLessons: [],
    markedReady: [],
    markedTodo: [],
    deletedSections: [],
    deletedLessons: [],
  };

  const prevLessonLookup = buildLessonLookup(previousVersion);
  const prevSectionLookup = buildSectionLookup(previousVersion);
  const renamedSectionIds = new Set<string>();

  for (const section of currentVersion.sections) {
    if (section.previousVersionSectionId) {
      const prevSectionPath = prevSectionLookup.get(
        section.previousVersionSectionId
      );
      if (prevSectionPath && hasNameChanged(prevSectionPath, section.path)) {
        if (!renamedSectionIds.has(section.previousVersionSectionId)) {
          changes.renamedSections.push({
            oldPath: prevSectionPath,
            newPath: section.path,
          });
          renamedSectionIds.add(section.previousVersionSectionId);
        }
      }
    }

    for (const lesson of section.lessons) {
      const currentHasContent = lessonHasContent(lesson);
      const isTodo = lesson.authoringStatus === "todo";

      if (!lesson.previousVersionLessonId) {
        if (currentHasContent || isTodo) {
          changes.newLessons.push({
            sectionPath: section.path,
            lessonPath: lesson.path,
            videoTitles: getVideosWithContent(lesson),
            authoringStatus: lesson.authoringStatus,
          });
        }
      } else {
        const prevLesson = prevLessonLookup.get(lesson.previousVersionLessonId);
        if (!prevLesson) {
          if (currentHasContent || isTodo) {
            changes.newLessons.push({
              sectionPath: section.path,
              lessonPath: lesson.path,
              videoTitles: getVideosWithContent(lesson),
              authoringStatus: lesson.authoringStatus,
            });
          }
        } else {
          const prevHadContent = lessonHasContent(prevLesson.lesson);
          const prevStatus = prevLesson.lesson.authoringStatus;
          const curStatus = lesson.authoringStatus;
          const statusFlipped =
            prevStatus !== null &&
            curStatus !== null &&
            prevStatus !== curStatus;

          if (statusFlipped) {
            if (prevStatus === "todo" && curStatus === "done") {
              changes.markedReady.push({
                sectionPath: section.path,
                lessonPath: lesson.path,
              });
            } else {
              changes.markedTodo.push({
                sectionPath: section.path,
                lessonPath: lesson.path,
              });
            }
            // Status transitions take precedence — skip the rename bucket for
            // this lesson. Still emit any video-content changes below.
            if (prevHadContent && currentHasContent) {
              const videoChanges = detectVideoChanges(lesson, prevLesson);
              if (videoChanges.length > 0) {
                changes.updatedLessons.push({
                  sectionPath: section.path,
                  lessonPath: lesson.path,
                  videoChanges,
                });
              }
            }
          } else if (!prevHadContent && currentHasContent) {
            changes.newLessons.push({
              sectionPath: section.path,
              lessonPath: lesson.path,
              videoTitles: getVideosWithContent(lesson),
              authoringStatus: lesson.authoringStatus,
            });
          } else if (prevHadContent && !currentHasContent) {
            changes.deletedLessons.push({
              sectionPath: section.path,
              lessonPath: prevLesson.lessonPath,
              videoTitles: [...prevLesson.videosByTitle.entries()]
                .filter(([, v]) => v.diffArray.length > 0)
                .map(([p]) => p),
            });
          } else if (prevHadContent && currentHasContent) {
            if (hasNameChanged(prevLesson.lessonPath, lesson.path)) {
              changes.renamedLessons.push({
                sectionPath: section.path,
                oldPath: prevLesson.lessonPath,
                newPath: lesson.path,
              });
            }

            const videoChanges = detectVideoChanges(lesson, prevLesson);
            if (videoChanges.length > 0) {
              changes.updatedLessons.push({
                sectionPath: section.path,
                lessonPath: lesson.path,
                videoChanges,
              });
            }
          }
        }
      }
    }
  }

  const referencedSectionIds = new Set<string>();
  const referencedLessonIds = new Set<string>();

  for (const section of currentVersion.sections) {
    if (section.previousVersionSectionId) {
      referencedSectionIds.add(section.previousVersionSectionId);
    }
    for (const lesson of section.lessons) {
      if (lesson.previousVersionLessonId) {
        referencedLessonIds.add(lesson.previousVersionLessonId);
      }
    }
  }

  for (const prevSection of previousVersion.sections) {
    if (!referencedSectionIds.has(prevSection.id)) {
      changes.deletedSections.push({ sectionPath: prevSection.path });
    } else {
      for (const prevLesson of prevSection.lessons) {
        if (
          !referencedLessonIds.has(prevLesson.id) &&
          lessonHasContent(prevLesson)
        ) {
          changes.deletedLessons.push({
            sectionPath: prevSection.path,
            lessonPath: prevLesson.path,
            videoTitles: getVideosWithContent(prevLesson),
          });
        }
      }
    }
  }

  return changes;
}
