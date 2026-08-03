import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { uploadReducer } from "./upload-reducer";
import { UploadRow } from "./upload-row";

const base: uploadReducer.BaseUploadEntry = {
  uploadId: "u1",
  videoId: "v1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
};

const render = (upload: uploadReducer.UploadEntry) =>
  renderToStaticMarkup(<UploadRow upload={upload} onDismiss={() => {}} />);

/** The `aria-valuenow` of every progress bar in the row, in document order. */
const bars = (html: string) =>
  [
    ...html.matchAll(
      /<div[^>]*role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*>/g
    ),
  ].map((m) => Number(m[1]));

describe("UploadRow progress indicator", () => {
  it("shows a progress bar for an in-flight export", () => {
    const html = render({
      ...base,
      progress: 42,
      uploadType: "export",
      exportStage: "concatenating-clips",
      isBatchEntry: false,
      videoUploadStage: null,
      uploadedBytes: 0,
      totalBytes: null,
    });

    expect(bars(html)).toEqual([42]);
    expect(html).toContain("Concatenating clips");
    expect(html).toContain("42%");
  });

  it("shows a progress bar for every in-flight publish stage, not just uploading", () => {
    const html = render({
      ...base,
      progress: 5,
      uploadType: "publish",
      publishStage: "validating",
      newDraftVersionId: null,
      courseId: "c1",
    });

    expect(bars(html)).toEqual([5]);
    expect(html).toContain("Validating");
  });

  it("shows a progress bar for every in-flight buffer stage, not just the blob upload", () => {
    const html = render({
      ...base,
      progress: 70,
      uploadType: "buffer",
      bufferStage: "polling",
    });

    expect(bars(html)).toEqual([70]);
    expect(html).toContain("Waiting for delivery");
  });

  it("labels an in-flight vertical render with its stage", () => {
    const html = render({
      ...base,
      progress: 30,
      uploadType: "render-vertical",
      renderVerticalStage: "transcribing",
    });

    expect(bars(html)).toEqual([30]);
    expect(html).toContain("Transcribing audio");
  });

  it("shows a bare progress bar for a stageless upload", () => {
    const html = render({
      ...base,
      progress: 63,
      uploadType: "youtube",
      youtubeVideoId: null,
    });

    expect(bars(html)).toEqual([63]);
    expect(html).toContain("63%");
  });

  it("shows an empty progress bar for a job waiting on its dependency", () => {
    const html = render({
      ...base,
      status: "waiting",
      uploadType: "youtube",
      youtubeVideoId: null,
      dependsOn: "u0",
      parentUploadId: null,
    });

    expect(bars(html)).toEqual([0]);
    expect(html).toContain("Waiting for export");
  });

  it("keeps a retrying job's progress bar visible", () => {
    const html = render({
      ...base,
      progress: 20,
      status: "retrying",
      retryCount: 1,
      uploadType: "export",
      exportStage: "concatenating-clips",
      isBatchEntry: false,
      videoUploadStage: null,
      uploadedBytes: 0,
      totalBytes: null,
    });

    expect(bars(html)).toEqual([20]);
    expect(html).toContain("Retrying");
  });

  it("shows an unlabelled progress bar before a staged job reports its stage", () => {
    const html = render({
      ...base,
      progress: 12,
      uploadType: "export",
      exportStage: null,
      isBatchEntry: false,
      videoUploadStage: null,
      uploadedBytes: 0,
      totalBytes: null,
    });

    expect(bars(html)).toEqual([12]);
    expect(html).toContain("12%");
  });

  it("shows no progress bar once a job has succeeded", () => {
    const html = render({
      ...base,
      progress: 100,
      status: "success",
      uploadType: "export",
      exportStage: null,
      isBatchEntry: false,
      videoUploadStage: null,
      uploadedBytes: 0,
      totalBytes: null,
    });

    expect(bars(html)).toEqual([]);
    expect(html).toContain("Exported");
  });
});

describe("UploadRow success state", () => {
  it("names the destination for a job type that has one", () => {
    const html = render({
      ...base,
      progress: 100,
      status: "success",
      uploadType: "ai-hero",
      aiHeroSlug: "my-post",
    });

    expect(html).toContain("Posted to AI Hero");
    expect(html).toContain("https://aihero.dev/my-post");
  });

  it("falls back to Complete for a job type with no destination of its own", () => {
    const html = render({
      ...base,
      progress: 100,
      status: "success",
      uploadType: "render-vertical",
      renderVerticalStage: null,
    });

    expect(html).toContain("Complete");
  });
});

const videoTask = (
  overrides: Partial<uploadReducer.ExportUploadEntry> = {}
): uploadReducer.ExportUploadEntry => ({
  ...base,
  parentUploadId: "pub-1",
  uploadType: "export",
  exportStage: null,
  isBatchEntry: true,
  videoUploadStage: null,
  uploadedBytes: 0,
  totalBytes: null,
  ...overrides,
});

describe("UploadRow for a per-Video task under a Publish", () => {
  it("indents a child task so it reads as belonging to its parent", () => {
    const flat = renderToStaticMarkup(
      <UploadRow upload={videoTask()} onDismiss={() => {}} />
    );
    const nested = renderToStaticMarkup(
      <UploadRow upload={videoTask()} onDismiss={() => {}} nested />
    );

    expect(flat).not.toContain('data-nested="true"');
    expect(nested).toContain('data-nested="true"');
  });

  it("names each phase of the Video's life", () => {
    expect(
      render(videoTask({ progress: 20, exportStage: "concatenating-clips" }))
    ).toContain("Concatenating clips");
    expect(
      render(videoTask({ progress: 50, videoUploadStage: "queued-for-upload" }))
    ).toContain("Waiting to upload");
    expect(
      render(videoTask({ progress: 74, videoUploadStage: "uploading" }))
    ).toContain("Uploading to Dropbox");
  });

  it("says the Video was uploaded, not merely exported, once it lands", () => {
    expect(render(videoTask({ progress: 100, status: "success" }))).toContain(
      "Uploaded"
    );
  });

  it("attributes a failure to the Video by name", () => {
    const html = render(
      videoTask({
        status: "error",
        errorMessage: "HTTP 400: insufficient_space",
      })
    );

    expect(html).toContain("Test Video");
    expect(html).toContain("HTTP 400: insufficient_space");
  });
});
