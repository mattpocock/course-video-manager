import {
  computeContentHash,
  type DiffContext,
  type DiffInput,
  type DiffMessage,
  type CatStamp,
  type ArchivedEntity,
} from "./derive-diff";
import { buildVfsTree, type CourseEntry, type VfsDirNode } from "./vfs-tree";
import { vfsCat } from "./vfs-cat";

export const makeCourseEntry = (
  overrides: Partial<CourseEntry> = {}
): CourseEntry => ({
  slug: "my-course",
  courseLeaf: {
    id: "c1",
    name: "My Course",
    memory: "",
    version: { id: "v1", name: "Draft", description: "" },
  },
  sections: [],
  ...overrides,
});

export const fullCourse = makeCourseEntry({
  sections: [
    {
      path: "01-intro",
      sectionLeaf: {
        id: "s1",
        title: "Intro",
        slug: "intro",
        description: "Intro section",
        real: true,
      },
      ghost: false,
      lessons: [
        {
          path: "01.01-hello",
          lessonLeaf: {
            id: "l1",
            title: "Hello",
            slug: "hello",
            description: "First lesson",
            icon: null,
            priority: 2,
            dependencies: [],
            authoringStatus: "todo",
            fsStatus: "real",
          },
          ghost: false,
          videos: [
            {
              path: "take-1",
              videoLeaf: {
                id: "vid1",
                name: "take-1",
                originalFootagePath: "/raw.mp4",
                warnings: [],
              },
              beats: [
                {
                  id: "seg1",
                  kind: "definition",
                  title: "Intro",
                  description: "Opening definition",
                },
                {
                  id: "seg2",
                  kind: "walkthrough",
                  title: "Main",
                  description: "Main walkthrough",
                },
              ],
              timelineItems: [
                { type: "chapter" as const, id: "ch1", name: "Opening" },
                {
                  type: "clip" as const,
                  id: "cl1",
                  text: "Hello world, this is the first clip.",
                  sourceStartTime: 0,
                  sourceEndTime: 3,
                  videoFilename: "raw.mp4",
                  pauseType: "none",
                  scene: null,
                  profile: null,
                },
                {
                  type: "clip" as const,
                  id: "cl2",
                  text: "And this is the second clip.",
                  sourceStartTime: 5,
                  sourceEndTime: 8,
                  videoFilename: "raw.mp4",
                  pauseType: "none",
                  scene: null,
                  profile: null,
                },
              ],
            },
          ],
        },
        {
          path: "01.02-world",
          lessonLeaf: {
            id: "l2",
            title: "World",
            slug: "world",
            description: "Second lesson",
            icon: "globe",
            priority: 3,
            dependencies: ["l1"],
            authoringStatus: "done",
            fsStatus: "real",
          },
          ghost: false,
          videos: [],
        },
      ],
    },
    {
      path: "02-empty",
      sectionLeaf: {
        id: "s2",
        title: "Empty",
        slug: "empty",
        description: "Empty section",
        real: false,
      },
      ghost: true,
      lessons: [],
    },
  ],
});

export function buildCtx(
  course: CourseEntry = fullCourse,
  archived: Map<string, ArchivedEntity> = new Map()
): DiffContext {
  return { root: buildVfsTree([course]), archived };
}

export function stampCat(
  root: VfsDirNode,
  path: string,
  filter?: string
): CatStamp {
  const content = vfsCat(root, path, filter);
  return { content, path, hash: computeContentHash(content) };
}

export function makeMessages(stamps: CatStamp[]): DiffMessage[] {
  return stamps.map((stamp) => ({
    role: "tool",
    content: [
      {
        type: "tool-result" as const,
        toolCallId: `call-${stamp.path}`,
        toolName: "cat",
        result: stamp,
      },
    ],
  }));
}

export function writeInput(path: string, content: string): DiffInput {
  return { path, content };
}
