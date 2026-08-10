import { describe, expect, it } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const reduceAll = (
  state: uploadReducer.State,
  actions: uploadReducer.Action[]
) => actions.reduce(reduce, state);

/** An Autofill run with one child row per candidate Video. */
const startedAutofill = (videoIds: string[]) =>
  reduceAll(createInitialUploadState(), [
    {
      type: "START_UPLOAD",
      uploadId: "fill-1",
      videoId: "",
      title: "Autofill My Course",
      uploadType: "autofill",
      courseId: "course-1",
    },
    { type: "UPDATE_AUTOFILL_STAGE", uploadId: "fill-1", stage: "writing" },
    ...videoIds.map((videoId): uploadReducer.Action => ({
      type: "START_UPLOAD",
      uploadId: `fill-1-video-${videoId}`,
      videoId,
      title: `01-intro/01.01-welcome/${videoId}`,
      uploadType: "autofill",
      parentUploadId: "fill-1",
    })),
  ]);

const row = (state: uploadReducer.State, uploadId: string) => {
  const entry = state.uploads[uploadId]!;
  if (entry.uploadType !== "autofill") throw new Error("not an autofill row");
  return entry;
};

describe("an Autofill run in the upload manager", () => {
  it("nests one child row per candidate Video under the run", () => {
    const state = startedAutofill(["vid-1", "vid-2"]);

    expect(row(state, "fill-1-video-vid-1").parentUploadId).toBe("fill-1");
    expect(row(state, "fill-1-video-vid-2").parentUploadId).toBe("fill-1");
    expect(row(state, "fill-1").parentUploadId).toBeNull();
    // A Video that was never a candidate has no row: the list is about work,
    // not about exclusions.
    expect(Object.keys(state.uploads)).toHaveLength(3);
  });

  it("derives the run's progress from its children", () => {
    let state = startedAutofill(["vid-1", "vid-2"]);
    const before = row(state, "fill-1").progress;

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "fill-1-video-vid-1",
    });

    expect(row(state, "fill-1-video-vid-1").progress).toBe(100);
    expect(row(state, "fill-1").progress).toBeGreaterThan(before);
    expect(row(state, "fill-1").progress).toBeLessThan(100);

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "fill-1-video-vid-2",
    });
    // Both children done, but the run's own row is only complete once the
    // stream says so.
    expect(row(state, "fill-1").status).toBe("uploading");
    expect(row(state, "fill-1").progress).toBeGreaterThan(90);

    state = reduce(state, { type: "UPLOAD_SUCCESS", uploadId: "fill-1" });
    expect(row(state, "fill-1").status).toBe("success");
    expect(row(state, "fill-1").progress).toBe(100);
    expect(row(state, "fill-1").autofillStage).toBeNull();
  });

  it("fails one Video terminally without touching the others", () => {
    let state = startedAutofill(["vid-1", "vid-2"]);

    state = reduce(state, {
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "fill-1-video-vid-1",
      errorMessage: "the model refused",
    });

    expect(row(state, "fill-1-video-vid-1").status).toBe("error");
    expect(row(state, "fill-1-video-vid-1").terminal).toBe(true);
    expect(row(state, "fill-1-video-vid-2").status).toBe("uploading");
  });

  it("dismissing the run takes its per-Video rows with it", () => {
    let state = startedAutofill(["vid-1", "vid-2"]);
    state = reduce(state, { type: "DISMISS", uploadId: "fill-1" });

    expect(Object.keys(state.uploads)).toHaveLength(0);
  });

  it("leaves a settled row settled when a late stage event arrives", () => {
    let state = startedAutofill(["vid-1"]);
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "fill-1-video-vid-1",
    });

    state = reduce(state, {
      type: "UPDATE_AUTOFILL_STAGE",
      uploadId: "fill-1-video-vid-1",
      stage: "writing",
    });

    expect(row(state, "fill-1-video-vid-1").status).toBe("success");
    expect(row(state, "fill-1-video-vid-1").autofillStage).toBeNull();
  });

  it("does not touch a Publish running beside it", () => {
    let state = startedAutofill(["vid-1"]);
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "pub-1",
      videoId: "",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    });

    state = reduce(state, {
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "fill-1",
      errorMessage: "rate limited",
    });

    // A failed Autofill can never fail a Publish: the two are separate
    // entries with separate failure states.
    expect(state.uploads["pub-1"]!.status).toBe("uploading");
    expect(state.uploads["pub-1"]!.errorMessage).toBeNull();
  });
});
