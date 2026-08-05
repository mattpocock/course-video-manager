import { describe, expect, it } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const createState = (
  overrides: Partial<uploadReducer.State> = {}
): uploadReducer.State => ({
  ...createInitialUploadState(),
  ...overrides,
});

const createYouTubeEntry = (
  overrides: Partial<Omit<uploadReducer.YouTubeUploadEntry, "uploadType">> = {}
): uploadReducer.YouTubeUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "youtube",
  youtubeVideoId: null,
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  ...overrides,
});

const createBufferEntry = (
  overrides: Partial<Omit<uploadReducer.BufferUploadEntry, "uploadType">> = {}
): uploadReducer.BufferUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "buffer",
  bufferStage: null,
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  ...overrides,
});

const createPublishEntry = (
  overrides: Partial<Omit<uploadReducer.PublishUploadEntry, "uploadType">> = {}
): uploadReducer.PublishUploadEntry => ({
  uploadId: "upload-1",
  videoId: "",
  title: "My Course",
  progress: 0,
  status: "uploading",
  uploadType: "publish",
  publishStage: null,
  newDraftVersionId: null,
  courseId: "course-1",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  ...overrides,
});

/** Every value `progress` took, starting from the entry's own. */
const progressOver = (
  entry: uploadReducer.UploadEntry,
  actions: uploadReducer.Action[]
) => {
  let state = createState({ uploads: { "upload-1": entry } });
  const seen = [entry.progress];
  for (const action of actions) {
    state = reduce(state, action);
    seen.push(state.uploads["upload-1"]!.progress);
  }
  return seen;
};

const isMonotonic = (values: number[]) =>
  values.every((value, i) => i === 0 || value >= values[i - 1]!);

// The job viewer draws a bar from `progress` for every unfinished job, so a
// stage handover that lowers `progress` is visible as the bar running
// backwards. These walk the event orders the SSE clients really produce.
describe("progress never runs backwards", () => {
  it("keeps the buffer bar climbing once the blob upload reports 100%", () => {
    // sse-social-client re-announces "uploading-blob" with each percentage, so
    // the blob finishing at 100% used to leave `progress` above the fixed 50
    // that "creating-post" then assigned.
    const seen = progressOver(createBufferEntry(), [
      {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "uploading-blob",
      },
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 0 },
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 100 },
      {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "creating-post",
      },
      { type: "UPDATE_BUFFER_STAGE", uploadId: "upload-1", stage: "polling" },
      {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "cleaning-up",
      },
    ]);

    expect(isMonotonic(seen)).toBe(true);
    expect(seen.at(-1)).toBe(90);
  });

  it("keeps the publish bar climbing across the prologue and into the work", () => {
    // The real emission order: validate, Submit (freeze then clone), and only
    // then the overlapping export and upload.
    const seen = progressOver(createPublishEntry(), [
      {
        type: "UPDATE_PUBLISH_STAGE",
        uploadId: "upload-1",
        stage: "validating",
      },
      { type: "UPDATE_PUBLISH_STAGE", uploadId: "upload-1", stage: "freezing" },
      { type: "UPDATE_PUBLISH_STAGE", uploadId: "upload-1", stage: "cloning" },
      {
        type: "UPDATE_PUBLISH_STAGE",
        uploadId: "upload-1",
        stage: "exporting",
      },
      {
        type: "UPDATE_PUBLISH_STAGE",
        uploadId: "upload-1",
        stage: "uploading",
      },
    ]);

    expect(isMonotonic(seen)).toBe(true);
    expect(seen.at(-1)).toBe(10);
  });

  it("ignores a bundle-wide percentage aimed at the publish bar", () => {
    // The Publish's bar is derived from its per-Video children; the aggregate
    // the server also reports must not be able to overwrite it.
    const seen = progressOver(createPublishEntry({ progress: 40 }), [
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 99 },
    ]);

    expect(seen).toEqual([40, 40]);
  });

  it("ignores a late progress event from a stage the job has left", () => {
    const seen = progressOver(createBufferEntry({ bufferStage: "polling" }), [
      {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "cleaning-up",
      },
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 10 },
    ]);

    expect(seen.at(-1)).toBe(90);
  });

  it("still streams a real percentage straight through for a plain upload", () => {
    const seen = progressOver(createYouTubeEntry(), [
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 37 },
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 82 },
    ]);

    expect(seen).toEqual([0, 37, 82]);
  });
});
