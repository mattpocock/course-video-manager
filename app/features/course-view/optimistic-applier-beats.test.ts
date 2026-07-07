import { describe, it, expect } from "vitest";
import { applyOptimisticEvent } from "./optimistic-applier";
import {
  makeVideo,
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Beat } from "./course-view-types";

const makeBeat = (overrides: Partial<Beat> = {}): Beat =>
  ({
    id: "seg-1",
    videoId: "video-1",
    kind: "definition",
    title: "",
    description: "",
    order: "a0",
    ...overrides,
  }) as Beat;

const loaderWithBeats = (beats: Beat[], videoId = "video-1") =>
  makeLoaderData([
    makeSection({}, [
      makeLesson({ videos: [makeVideo({ id: videoId, beats })] }),
    ]),
  ]);

const beatsOf = (data: ReturnType<typeof loaderWithBeats>) =>
  data.selectedCourse!.sections[0]!.lessons[0]!.videos[0]!.beats;

describe("rename-beat", () => {
  it("updates the matching beat's title", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1", title: "" })]);
    const event: CourseEditorEvent = {
      type: "rename-beat",
      beatId: "seg-1",
      title: "Closures",
    };

    const result = applyOptimisticEvent(data, event);

    expect(beatsOf(result)[0]!.title).toBe("Closures");
  });

  it("does not mutate the original loaderData", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1", title: "" })]);
    applyOptimisticEvent(data, {
      type: "rename-beat",
      beatId: "seg-1",
      title: "Closures",
    });
    expect(beatsOf(data)[0]!.title).toBe("");
  });

  it("returns loaderData unchanged when the beat is not found", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1" })]);
    const result = applyOptimisticEvent(data, {
      type: "rename-beat",
      beatId: "nope",
      title: "x",
    });
    expect(result).toBe(data);
  });
});

describe("update-beat-description", () => {
  it("updates the matching beat's description", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1", description: "" })]);
    const result = applyOptimisticEvent(data, {
      type: "update-beat-description",
      beatId: "seg-1",
      description: "What I'll say in this part",
    });
    expect(beatsOf(result)[0]!.description).toBe("What I'll say in this part");
  });

  it("returns loaderData unchanged when the beat is not found", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1" })]);
    const result = applyOptimisticEvent(data, {
      type: "update-beat-description",
      beatId: "nope",
      description: "x",
    });
    expect(result).toBe(data);
  });
});

describe("set-beat-kind", () => {
  it("changes the matching beat's kind", () => {
    const data = loaderWithBeats([
      makeBeat({ id: "seg-1", kind: "definition" }),
    ]);
    const result = applyOptimisticEvent(data, {
      type: "set-beat-kind",
      beatId: "seg-1",
      kind: "quest",
    });
    expect(beatsOf(result)[0]!.kind).toBe("quest");
  });
});

describe("delete-beat", () => {
  it("removes the matching beat", () => {
    const data = loaderWithBeats([
      makeBeat({ id: "seg-1" }),
      makeBeat({ id: "seg-2", order: "a1" }),
    ]);
    const result = applyOptimisticEvent(data, {
      type: "delete-beat",
      beatId: "seg-1",
    });
    expect(beatsOf(result).map((s) => s.id)).toEqual(["seg-2"]);
  });

  it("returns loaderData unchanged when the beat is not found", () => {
    const data = loaderWithBeats([makeBeat({ id: "seg-1" })]);
    const result = applyOptimisticEvent(data, {
      type: "delete-beat",
      beatId: "nope",
    });
    expect(result).toBe(data);
  });

  it("preserves reference equality for untouched sections", () => {
    const segVideo = makeVideo({ id: "video-1", beats: [makeBeat()] });
    const section1 = makeSection({ id: "s1" }, [
      makeLesson({ id: "l1", videos: [segVideo] }),
    ]);
    const section2 = makeSection({ id: "s2" }, [makeLesson({ id: "l2" })]);
    const data = makeLoaderData([section1, section2]);

    const result = applyOptimisticEvent(data, {
      type: "delete-beat",
      beatId: "seg-1",
    });

    expect(result.selectedCourse!.sections[1]).toBe(section2);
  });
});

describe("move-beat", () => {
  const twoVideoLoader = () =>
    makeLoaderData([
      makeSection({}, [
        makeLesson({
          id: "l1",
          videos: [
            makeVideo({
              id: "v1",
              beats: [
                makeBeat({ id: "a", order: "a0" }),
                makeBeat({ id: "b", order: "a1" }),
              ],
            }),
            makeVideo({ id: "v2", path: "v2.mp4", beats: [] }),
          ],
        }),
      ]),
    ]);

  const videoSegs = (
    data: ReturnType<typeof twoVideoLoader>,
    videoIdx: number
  ) => data.selectedCourse!.sections[0]!.lessons[0]!.videos[videoIdx]!.beats;

  it("reorders within a video", () => {
    const data = twoVideoLoader();
    const result = applyOptimisticEvent(data, {
      type: "move-beat",
      beatId: "b",
      targetVideoId: "v1",
      beforeBeatId: "a",
    });
    expect(videoSegs(result, 0).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("moves a beat into another video and updates its videoId", () => {
    const data = twoVideoLoader();
    const result = applyOptimisticEvent(data, {
      type: "move-beat",
      beatId: "a",
      targetVideoId: "v2",
      beforeBeatId: null,
    });
    expect(videoSegs(result, 0).map((s) => s.id)).toEqual(["b"]);
    expect(videoSegs(result, 1).map((s) => s.id)).toEqual(["a"]);
    expect(videoSegs(result, 1)[0]!.videoId).toBe("v2");
  });

  it("does not mutate the original loaderData", () => {
    const data = twoVideoLoader();
    applyOptimisticEvent(data, {
      type: "move-beat",
      beatId: "a",
      targetVideoId: "v2",
      beforeBeatId: null,
    });
    expect(videoSegs(data, 0).map((s) => s.id)).toEqual(["a", "b"]);
    expect(videoSegs(data, 1)).toHaveLength(0);
  });

  it("returns loaderData unchanged when the beat is not found", () => {
    const data = twoVideoLoader();
    const result = applyOptimisticEvent(data, {
      type: "move-beat",
      beatId: "nope",
      targetVideoId: "v2",
      beforeBeatId: null,
    });
    expect(result).toBe(data);
  });
});
