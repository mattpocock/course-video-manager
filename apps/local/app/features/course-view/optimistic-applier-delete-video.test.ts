import { describe, it, expect } from "vitest";
import {
  applyOptimisticDeleteVideo,
  deleteVideoFetcherKey,
  DELETE_VIDEO_KEY_PREFIX,
} from "./optimistic-applier";
import {
  makeVideo,
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";

describe("applyOptimisticDeleteVideo", () => {
  it("removes the matching video from a lesson", () => {
    const video1 = makeVideo({ id: "video-1" });
    const video2 = makeVideo({ id: "video-2", title: "video-02.mp4" });
    const lesson = makeLesson({ videos: [video1, video2] });
    const loaderData = makeLoaderData([makeSection({}, [lesson])]);

    const result = applyOptimisticDeleteVideo(loaderData, "video-1");

    expect(result.selectedCourse!.sections[0]!.lessons[0]!.videos).toHaveLength(
      1
    );
    expect(result.selectedCourse!.sections[0]!.lessons[0]!.videos[0]!.id).toBe(
      "video-2"
    );
  });

  it("returns loaderData unchanged when videoId is not found", () => {
    const lesson = makeLesson({ videos: [makeVideo()] });
    const loaderData = makeLoaderData([makeSection({}, [lesson])]);

    const result = applyOptimisticDeleteVideo(loaderData, "nonexistent");

    expect(result).toBe(loaderData);
  });

  it("returns loaderData unchanged when selectedCourse is undefined", () => {
    const loaderData = makeLoaderData();
    (loaderData as any).selectedCourse = undefined;

    const result = applyOptimisticDeleteVideo(loaderData, "video-1");

    expect(result).toBe(loaderData);
  });

  it("does not mutate the original loaderData", () => {
    const video = makeVideo({ id: "video-1" });
    const lesson = makeLesson({ videos: [video] });
    const loaderData = makeLoaderData([makeSection({}, [lesson])]);

    const result = applyOptimisticDeleteVideo(loaderData, "video-1");

    expect(result).not.toBe(loaderData);
    expect(result.selectedCourse).not.toBe(loaderData.selectedCourse);
    expect(
      loaderData.selectedCourse!.sections[0]!.lessons[0]!.videos
    ).toHaveLength(1);
  });

  it("preserves reference equality for unchanged sections", () => {
    const section1 = makeSection({ id: "section-1" }, [
      makeLesson({ id: "lesson-1", videos: [] }),
    ]);
    const section2 = makeSection({ id: "section-2" }, [
      makeLesson({ id: "lesson-2", videos: [makeVideo({ id: "video-1" })] }),
    ]);
    const loaderData = makeLoaderData([section1, section2]);

    const result = applyOptimisticDeleteVideo(loaderData, "video-1");

    expect(result.selectedCourse!.sections[0]).toBe(section1);
    expect(result.selectedCourse!.sections[1]).not.toBe(section2);
  });

  it("finds the video across multiple sections and lessons", () => {
    const lesson1 = makeLesson({ id: "lesson-1", videos: [] });
    const lesson2 = makeLesson({
      id: "lesson-2",
      videos: [makeVideo({ id: "video-target" })],
    });
    const section1 = makeSection({ id: "section-1" }, [lesson1]);
    const section2 = makeSection({ id: "section-2" }, [lesson2]);
    const loaderData = makeLoaderData([section1, section2]);

    const result = applyOptimisticDeleteVideo(loaderData, "video-target");

    expect(result.selectedCourse!.sections[1]!.lessons[0]!.videos).toHaveLength(
      0
    );
    expect(result.selectedCourse!.sections[0]).toBe(section1);
  });

  it("leaves an empty videos array when the only video is deleted", () => {
    const lesson = makeLesson({
      id: "lesson-1",
      videos: [makeVideo({ id: "only-video" })],
    });
    const loaderData = makeLoaderData([makeSection({}, [lesson])]);

    const result = applyOptimisticDeleteVideo(loaderData, "only-video");

    expect(result.selectedCourse!.sections[0]!.lessons[0]!.videos).toEqual([]);
  });

  it("applies two sequential deletes on the same lesson", () => {
    const lesson = makeLesson({
      id: "lesson-1",
      videos: [
        makeVideo({ id: "v1", title: "v1.mp4" }),
        makeVideo({ id: "v2", title: "v2.mp4" }),
        makeVideo({ id: "v3", title: "v3.mp4" }),
      ],
    });
    const loaderData = makeLoaderData([makeSection({}, [lesson])]);

    const after1 = applyOptimisticDeleteVideo(loaderData, "v1");
    const after2 = applyOptimisticDeleteVideo(after1, "v3");

    const remaining = after2.selectedCourse!.sections[0]!.lessons[0]!.videos;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("v2");
  });

  it("returns loaderData unchanged when sections array is empty", () => {
    const loaderData = makeLoaderData([]);

    const result = applyOptimisticDeleteVideo(loaderData, "video-1");

    expect(result).toBe(loaderData);
  });
});

describe("deleteVideoFetcherKey", () => {
  it("formats the key with the delete-video prefix", () => {
    expect(deleteVideoFetcherKey("video-123")).toBe("delete-video:video-123");
  });

  it("key starts with DELETE_VIDEO_KEY_PREFIX", () => {
    const key = deleteVideoFetcherKey("v1");
    expect(key.startsWith(DELETE_VIDEO_KEY_PREFIX)).toBe(true);
  });
});
