import type { LoaderData } from "./course-view-types";

export function makeVideo(
  overrides: Partial<
    LoaderData["selectedCourse"] extends infer C
      ? C extends {
          sections: Array<{ lessons: Array<{ videos: Array<infer V> }> }>;
        }
        ? V
        : never
      : never
  > = {}
) {
  return {
    id: "video-1",
    path: "video-01.mp4",
    totalDuration: 120,
    firstClipId: null,
    archived: false,
    createdAt: new Date(),
    lessonId: "lesson-1",
    pitchId: null,
    lineageId: "lineage-video-1",
    originalFootagePath: "/footage/video-01",
    body: null,
    description: null,
    updatedAt: new Date(),
    clipCount: 0,
    warnings: [],
    segments: [],
    ...overrides,
  };
}

export function makeLesson(
  overrides: Partial<
    LoaderData["selectedCourse"] extends infer C
      ? C extends { sections: Array<{ lessons: Array<infer L> }> }
        ? L
        : never
      : never
  > = {}
) {
  return {
    id: "lesson-1",
    path: "01-intro",
    title: "Introduction",
    description: null,
    icon: "watch" as const,
    priority: 2,
    dependencies: [],
    fsStatus: "real" as const,
    authoringStatus: "todo" as const,
    order: 0,
    videos: [],
    ...overrides,
  };
}

export function makeSection(
  overrides: Record<string, unknown> = {},
  lessons = [makeLesson()]
) {
  return {
    id: "section-1",
    path: "01-fundamentals",
    title: "Fundamentals",
    description: null,
    order: 0,
    lessons,
    ...overrides,
  };
}

export function makeLoaderData(sections = [makeSection()]): LoaderData {
  return {
    courses: [],
    standaloneVideos: [],
    selectedCourse: {
      id: "course-1",
      name: "Test Course",
      filePath: "/tmp/test-course",
      sections,
    },
    versions: [],
    selectedVersion: undefined,
    isLatestVersion: true,
    hasExportedVideoMap: Promise.resolve({}),
    lessonFsMaps: Promise.resolve({
      hasExplainerFolderMap: {},
      lessonHasFilesMap: {},
    }),
    videoTranscripts: Promise.resolve({}),
    gitStatus: Promise.resolve(null),
    showMediaFilesList: false,
  } as unknown as LoaderData;
}
