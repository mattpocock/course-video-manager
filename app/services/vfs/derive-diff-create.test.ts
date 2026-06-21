import { describe, it, expect } from "vitest";
import { deriveDiff, type AddOp } from "./derive-diff";
import {
  makeCourseEntry,
  buildCtx,
  writeInput,
} from "./derive-diff-test-helpers";

// A course whose single video has neither segments nor timeline items, so the
// projection omits both `segments/_members.json` and `timeline/_members.json`.
// This is the case the agent previously believed it could not handle.
const emptyVideoCourse = makeCourseEntry({
  sections: [
    {
      path: "01-intro",
      sectionLeaf: { id: "s1", slug: "intro", description: "", real: true },
      ghost: false,
      lessons: [
        {
          path: "01.01-hello",
          lessonLeaf: {
            id: "l1",
            title: "Hello",
            slug: "hello",
            description: "",
            icon: null,
            priority: 1,
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
              segments: [],
              timelineItems: [],
            },
          ],
        },
      ],
    },
  ],
});

const SEGMENTS_PATH =
  "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments/_members.json";
const TIMELINE_PATH =
  "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json";

describe("manifest create — first segment of a segment-less video", () => {
  it("creates the segments manifest without a prior cat (nothing to read)", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const result = deriveDiff(
      writeInput(
        SEGMENTS_PATH,
        JSON.stringify([{ id: null, kind: "definition", title: "Intro" }])
      ),
      [], // no cat — the file does not exist yet
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops).toHaveLength(1);
      expect((result.ops[0] as AddOp).type).toBe("add");
      expect((result.ops[0] as AddOp).sub).toBe("create");
      expect((result.ops[0] as AddOp).entityType).toBe("segment");
    }
  });

  it("creates the timeline manifest for a video with no timeline", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const result = deriveDiff(
      writeInput(
        TIMELINE_PATH,
        JSON.stringify([{ id: null, type: "chapter", label: "Opening" }])
      ),
      [],
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops).toHaveLength(1);
      expect((result.ops[0] as AddOp).sub).toBe("create");
      expect((result.ops[0] as AddOp).entityType).toBe("chapter");
    }
  });

  it("rejects an unknown id when creating (cannot invent ids)", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const result = deriveDiff(
      writeInput(
        SEGMENTS_PATH,
        JSON.stringify([{ id: "made-up", kind: "definition", title: "Intro" }])
      ),
      [],
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("identity-error");
  });

  it("rejects invalid manifest content on create", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const result = deriveDiff(
      writeInput(
        SEGMENTS_PATH,
        JSON.stringify([{ id: null, title: "no kind" }])
      ),
      [],
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("parse-error");
  });
});

describe("manifest create — bash-style No such file or directory", () => {
  it("rejects a write whose owning video does not exist", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const phantom =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/ghost-video/segments/_members.json";
    const result = deriveDiff(
      writeInput(
        phantom,
        JSON.stringify([{ id: null, kind: "definition", title: "Intro" }])
      ),
      [],
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("invalid-file");
      expect(result.rejection.message).toContain("No such file or directory");
    }
  });

  it("rejects edit (not write) against a non-existent manifest", () => {
    const ctx = buildCtx(emptyVideoCourse);
    const result = deriveDiff(
      {
        path: SEGMENTS_PATH,
        edits: [{ type: "replace", old_text: "[]", new_text: "[x]" }],
      },
      [],
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("invalid-file");
      expect(result.rejection.message).toContain("Use write");
    }
  });
});

describe("manifest create — concurrency: appears between propose and apply", () => {
  it("falls back to read-before-write once the file exists", () => {
    // Simulate the apply-time re-derive after a concurrent writer created the
    // manifest: the fresh VFS now HAS the segment, and the writer never cat-ed
    // it (it didn't exist at propose time) → not-read, forcing a re-cat.
    const withSegment = makeCourseEntry({
      sections: [
        {
          path: "01-intro",
          sectionLeaf: { id: "s1", slug: "intro", description: "", real: true },
          ghost: false,
          lessons: [
            {
              path: "01.01-hello",
              lessonLeaf: {
                id: "l1",
                title: "Hello",
                slug: "hello",
                description: "",
                icon: null,
                priority: 1,
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
                  segments: [
                    {
                      id: "seg1",
                      kind: "definition",
                      title: "Intro",
                      description: "",
                    },
                  ],
                  timelineItems: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const ctx = buildCtx(withSegment);
    const result = deriveDiff(
      writeInput(
        SEGMENTS_PATH,
        JSON.stringify([{ id: null, kind: "definition", title: "Intro" }])
      ),
      [], // writer never cat-ed it — it didn't exist when it proposed
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("not-read");
  });
});
