import { describe, expect, it } from "vitest";
import type { uploadReducer } from "./upload-reducer";
import { uploadStageLabel } from "./upload-progress";

const base: uploadReducer.BaseUploadEntry = {
  uploadId: "u1",
  videoId: "v1",
  title: "Test Video",
  progress: 40,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
};

describe("uploadStageLabel", () => {
  it("labels each export stage", () => {
    const labelFor = (stage: uploadReducer.ExportStage) =>
      uploadStageLabel({
        ...base,
        uploadType: "export",
        exportStage: stage,
        isBatchEntry: false,
      });

    expect(labelFor("queued")).toBe("Queued");
    expect(labelFor("concatenating-clips")).toBe("Concatenating clips");
    expect(labelFor("normalizing-audio")).toBe("Normalizing audio");
  });

  it("labels each publish stage", () => {
    const labelFor = (stage: uploadReducer.PublishStage) =>
      uploadStageLabel({
        ...base,
        uploadType: "publish",
        publishStage: stage,
        newDraftVersionId: null,
        courseId: "c1",
      });

    expect(labelFor("validating")).toBe("Validating");
    expect(labelFor("exporting")).toBe("Exporting videos");
    expect(labelFor("uploading")).toBe("Uploading to Dropbox");
    expect(labelFor("freezing")).toBe("Freezing version");
    expect(labelFor("cloning")).toBe("Creating new draft");
  });

  it("labels each buffer stage", () => {
    const labelFor = (stage: uploadReducer.BufferStage) =>
      uploadStageLabel({ ...base, uploadType: "buffer", bufferStage: stage });

    expect(labelFor("uploading-blob")).toBe("Uploading to cloud");
    expect(labelFor("creating-post")).toBe("Creating Buffer post");
    expect(labelFor("polling")).toBe("Waiting for delivery");
    expect(labelFor("cleaning-up")).toBe("Cleaning up");
  });

  it("labels each render-vertical stage", () => {
    const labelFor = (stage: uploadReducer.RenderVerticalStage) =>
      uploadStageLabel({
        ...base,
        uploadType: "render-vertical",
        renderVerticalStage: stage,
      });

    expect(labelFor("concatenating-clips")).toBe("Concatenating clips");
    expect(labelFor("transcribing")).toBe("Transcribing audio");
    expect(labelFor("rendering-overlay")).toBe("Rendering subtitles");
    expect(labelFor("compositing")).toBe("Compositing video");
  });

  it("has no label for a stageless job type", () => {
    expect(
      uploadStageLabel({ ...base, uploadType: "youtube", youtubeVideoId: null })
    ).toBeNull();
    expect(
      uploadStageLabel({ ...base, uploadType: "ai-hero", aiHeroSlug: null })
    ).toBeNull();
  });

  it("has no label for a staged job that has not reported a stage yet", () => {
    expect(
      uploadStageLabel({
        ...base,
        uploadType: "export",
        exportStage: null,
        isBatchEntry: false,
      })
    ).toBeNull();
  });
});
