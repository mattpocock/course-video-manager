import { describe, expect, it } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const reduceAll = (
  state: uploadReducer.State,
  actions: uploadReducer.Action[]
) => actions.reduce(reduce, state);

/** A Publish with one per-Video child task per id. */
const startedPublish = (videoIds: string[]) =>
  reduceAll(createInitialUploadState(), [
    {
      type: "START_UPLOAD",
      uploadId: "pub-1",
      videoId: "",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    },
    ...videoIds.map((videoId): uploadReducer.Action => ({
      type: "START_UPLOAD",
      uploadId: `pub-1-video-${videoId}`,
      videoId,
      title: `01-intro/01.01-welcome/${videoId}`,
      uploadType: "export",
      isBatchEntry: true,
      parentUploadId: "pub-1",
    })),
  ]);

const task = (state: uploadReducer.State, videoId: string) => {
  const entry = state.uploads[`pub-1-video-${videoId}`]!;
  if (entry.uploadType !== "export") throw new Error("not a video task");
  return entry;
};

describe("per-Video tasks under a Publish", () => {
  it("holds the parent link in state rather than in the caller's closure", () => {
    const state = startedPublish(["vid-1", "vid-2"]);

    expect(task(state, "vid-1").parentUploadId).toBe("pub-1");
    expect(task(state, "vid-2").parentUploadId).toBe("pub-1");
    expect(state.uploads["pub-1"]!.parentUploadId).toBeNull();
  });

  it("dismissing a Publish takes its per-Video tasks with it", () => {
    let state = startedPublish(["vid-1", "vid-2"]);
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "unrelated",
      videoId: "vid-9",
      title: "A standalone export",
      uploadType: "export",
    });

    state = reduce(state, { type: "DISMISS", uploadId: "pub-1" });

    expect(Object.keys(state.uploads)).toEqual(["unrelated"]);
  });

  it("walks one Video from encoding through waiting to uploading", () => {
    let state = startedPublish(["vid-1"]);
    expect(task(state, "vid-1").exportStage).toBe("queued");

    state = reduce(state, {
      type: "UPDATE_EXPORT_PROGRESS",
      uploadId: "pub-1-video-vid-1",
      stage: "concatenating-clips",
      percent: 50,
    });
    expect(task(state, "vid-1").exportStage).toBe("concatenating-clips");
    expect(task(state, "vid-1").videoUploadStage).toBeNull();
    // The export half owns the bottom of the bar, leaving room for the upload
    // half — unlike a standalone export, which spends the whole bar encoding.
    expect(task(state, "vid-1").progress).toBe(20);

    state = reduce(state, {
      type: "UPDATE_VIDEO_UPLOAD_STAGE",
      uploadId: "pub-1-video-vid-1",
      stage: "queued-for-upload",
    });
    expect(task(state, "vid-1").videoUploadStage).toBe("queued-for-upload");
    expect(task(state, "vid-1").exportStage).toBeNull();
    expect(task(state, "vid-1").progress).toBe(50);

    state = reduce(state, {
      type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
      uploadId: "pub-1-video-vid-1",
      uploadedBytes: 500,
      totalBytes: 1000,
    });
    expect(task(state, "vid-1").videoUploadStage).toBe("uploading");
    expect(task(state, "vid-1").progress).toBe(74);

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1-video-vid-1",
    });
    expect(task(state, "vid-1").status).toBe("success");
    expect(task(state, "vid-1").progress).toBe(100);
  });

  it("leaves a standalone export's own bands alone", () => {
    let state = reduce(createInitialUploadState(), {
      type: "START_UPLOAD",
      uploadId: "solo",
      videoId: "vid-1",
      title: "A standalone export",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "UPDATE_EXPORT_PROGRESS",
      uploadId: "solo",
      stage: "concatenating-clips",
      percent: 50,
    });

    expect(state.uploads["solo"]!.progress).toBe(40);
  });

  it("ignores replayed upload events for a Video that already landed", () => {
    // The Dropbox commit is retried once server-side, so a Video that landed
    // on the first attempt sees its progress events a second time.
    let state = startedPublish(["vid-1"]);
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1-video-vid-1",
    });

    state = reduce(state, {
      type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
      uploadId: "pub-1-video-vid-1",
      uploadedBytes: 0,
      totalBytes: 1000,
    });

    expect(task(state, "vid-1").status).toBe("success");
    expect(task(state, "vid-1").videoUploadStage).toBeNull();
    expect(task(state, "vid-1").progress).toBe(100);
  });

  it("attributes one Video's upload failure to that Video alone", () => {
    let state = startedPublish(["vid-1", "vid-2"]);
    state = reduce(state, {
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "pub-1-video-vid-2",
      errorMessage: "HTTP 400",
    });

    expect(task(state, "vid-2").status).toBe("error");
    expect(task(state, "vid-2").errorMessage).toBe("HTTP 400");
    expect(task(state, "vid-1").status).toBe("uploading");
    expect(state.uploads["pub-1"]!.status).toBe("uploading");
  });
});

describe("a Publish's progress is derived from its children", () => {
  it("weights each Video by its size on disk", () => {
    let state = startedPublish(["big", "small"]);

    // Sizes arrive with the first byte of each upload.
    state = reduceAll(state, [
      {
        type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
        uploadId: "pub-1-video-big",
        uploadedBytes: 0,
        totalBytes: 1_700_000_000,
      },
      {
        type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
        uploadId: "pub-1-video-small",
        uploadedBytes: 0,
        totalBytes: 200_000_000,
      },
    ]);
    const bothAtHalf = state.uploads["pub-1"]!.progress;

    // The small Video finishing outright moves the bar less than the big one
    // moving the same fraction of itself.
    const withSmallDone = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1-video-small",
    });
    const withBigDone = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1-video-big",
    });

    expect(withSmallDone.uploads["pub-1"]!.progress).toBeGreaterThan(
      bothAtHalf
    );
    expect(withBigDone.uploads["pub-1"]!.progress).toBeGreaterThan(
      withSmallDone.uploads["pub-1"]!.progress
    );
  });

  it("stands an unmeasured Video in at the mean rather than ignoring it", () => {
    // One Video is still encoding, so its size is unknown. If it were dropped
    // from the denominator the bar would read as though the course were half
    // the size it is.
    let state = startedPublish(["measured", "encoding"]);
    state = reduce(state, {
      type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
      uploadId: "pub-1-video-measured",
      uploadedBytes: 1000,
      totalBytes: 1000,
    });

    const parent = state.uploads["pub-1"]!.progress;
    // ~half the work done: the work band's floor plus about half its width.
    expect(parent).toBeGreaterThan(45);
    expect(parent).toBeLessThan(65);
  });

  it("never lets a finished Publish be dragged back by its children", () => {
    let state = startedPublish(["vid-1"]);
    state = reduce(state, { type: "UPLOAD_SUCCESS", uploadId: "pub-1" });
    expect(state.uploads["pub-1"]!.progress).toBe(100);

    state = reduce(state, {
      type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
      uploadId: "pub-1-video-vid-1",
      uploadedBytes: 1,
      totalBytes: 1000,
    });

    expect(state.uploads["pub-1"]!.progress).toBe(100);
  });

  it("tops out below 100 until the Publish itself completes", () => {
    let state = startedPublish(["vid-1"]);
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1-video-vid-1",
    });

    expect(state.uploads["pub-1"]!.progress).toBe(99);
    expect(state.uploads["pub-1"]!.status).toBe("uploading");
  });
});
