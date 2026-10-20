import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import {
  createInitialImageUploadState,
  imageUploadReducer,
} from "./image-upload-reducer";
import {
  IMAGE_UPLOADED_EVENT,
  UPLOAD_IMAGES_JOB_KIND,
  swapImageUploads,
} from "./image-upload-job";

const JOB = "job-1";
const BODY = "![a](a.png)\n![b](b.png)";

let nextId = 0;
const heard = (
  type: string,
  data: Record<string, unknown> = {},
  jobId = JOB
): imageUploadReducer.Action => ({
  type: "job-event-heard",
  heard: {
    job: {
      id: jobId,
      kind: UPLOAD_IMAGES_JOB_KIND,
      title: "Upload images",
      attempt: 1,
      maxAttempts: 1,
      subjectType: "video",
      subjectId: "video-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    event: {
      id: ++nextId,
      jobId,
      type,
      data,
      at: "2026-10-09T12:00:00.000Z",
    },
  } satisfies JobEventMessage,
});

const uploaded = (ref: string) =>
  heard(IMAGE_UPLOADED_EVENT, {
    ref,
    filePath: `/v/${ref}`,
    url: `https://c/${ref}`,
  });

const pressed = (deleteLocalFiles: boolean, body = BODY) =>
  ({
    type: "upload-pressed",
    jobId: JOB,
    videoId: "video-1",
    body,
    deleteLocalFiles,
  }) satisfies imageUploadReducer.Action;

const tester = () =>
  new ReducerTester(imageUploadReducer, createInitialImageUploadState());

describe("image upload, as a Job", () => {
  it("asks for the Job, and waits for it", () => {
    const t = tester().send(pressed(true));
    expect(t.getEffects()).toEqual([
      {
        type: "start-upload-job",
        jobId: JOB,
        videoId: "video-1",
        body: BODY,
      },
    ]);
    expect(t.getState().jobId).toBe(JOB);
  });

  it("ignores a second press while the Job runs", () => {
    const t = tester().send(pressed(true)).resetExec().send(pressed(false));
    expect(t.getEffects()).toEqual([]);
  });

  it("finishes at once when the body has no local image", () => {
    const t = tester().send(pressed(true, "no images"));
    expect(t.getEffects()).toEqual([
      {
        type: "swap-into-body",
        videoId: "video-1",
        uploads: [],
        deleteLocalFiles: false,
      },
    ]);
    expect(t.getState().jobId).toBeNull();
  });

  it("swaps every recorded image in once the Job settles, not before", () => {
    const t = tester()
      .send(pressed(true))
      .resetExec()
      .send(uploaded("a.png"))
      // A deliberate stop puts the Job back: not the end.
      .send(heard("requeued", { attempt: 1 }))
      .send(uploaded("a.png"))
      .send(uploaded("b.png"));
    expect(t.getEffects()).toEqual([]);
    t.send(heard("succeeded"));
    expect(t.getEffects()).toEqual([
      {
        type: "swap-into-body",
        videoId: "video-1",
        uploads: [
          { ref: "a.png", filePath: "/v/a.png", url: "https://c/a.png" },
          { ref: "b.png", filePath: "/v/b.png", url: "https://c/b.png" },
        ],
        deleteLocalFiles: true,
      },
    ]);
    expect(t.getState()).toEqual({
      ...createInitialImageUploadState(),
      saving: true,
    });
  });

  it("swaps in what was recorded when the Job fails part-way", () => {
    const t = tester()
      .send(pressed(false))
      .resetExec()
      .send(uploaded("a.png"))
      .send(heard("failed", { error: { message: "Image file not found" } }));
    expect(t.getEffects()).toEqual([
      {
        type: "swap-into-body",
        videoId: "video-1",
        uploads: [
          { ref: "a.png", filePath: "/v/a.png", url: "https://c/a.png" },
        ],
        deleteLocalFiles: false,
      },
    ]);
  });

  it("ignores another Job's events", () => {
    const t = tester()
      .send(pressed(true))
      .resetExec()
      .send(heard("succeeded", {}, "someone-elses-job"));
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().jobId).toBe(JOB);
  });

  it("stops waiting when the request itself failed", () => {
    const t = tester()
      .send(pressed(true))
      .resetExec()
      .send({ type: "job-enqueue-failed", jobId: JOB });
    expect(t.getEffects().map((e) => e.type)).toEqual(["swap-into-body"]);
    expect(t.getState().jobId).toBeNull();
  });

  it("removes nothing until the swapped body's save is confirmed, and nothing if it fails", () => {
    const settled = () =>
      tester()
        .send(pressed(true))
        .send(uploaded("a.png"))
        .send(heard("succeeded"))
        .resetExec();
    // Settled, swapped, saving: nothing is removed yet.
    expect(settled().getEffects()).toEqual([]);
    expect(settled().getState().saving).toBe(true);

    const failed = settled().send({
      type: "body-save-failed",
      videoId: "video-1",
      swappedFilePaths: ["/v/a.png"],
      deleteLocalFiles: true,
    });
    expect(failed.getEffects().map((e) => e.type)).toEqual([
      "show-save-failed-toast",
    ]);
    expect(failed.getState().saving).toBe(false);

    // Apply again: the body already holds the URL, so nothing is uploaded,
    // and the file goes once this save lands.
    const swappedBody = "![a](https://c/a.png)";
    failed.resetExec().send(pressed(true, swappedBody));
    expect(failed.getEffects()).toEqual([
      {
        type: "swap-into-body",
        videoId: "video-1",
        uploads: [],
        deleteLocalFiles: false,
      },
    ]);
    failed.resetExec().send({
      type: "body-saved",
      videoId: "video-1",
      savedBody: swappedBody,
      swappedFilePaths: [],
      deleteLocalFiles: false,
    });
    expect(failed.getEffects()[0]).toEqual({
      type: "remove-local-images",
      videoId: "video-1",
      filePaths: ["/v/a.png"],
    });

    const saved = settled().send({
      type: "body-saved",
      videoId: "video-1",
      savedBody: "![a](https://c/a.png)",
      swappedFilePaths: ["/v/a.png"],
      deleteLocalFiles: true,
    });
    expect(saved.getEffects()).toEqual([
      {
        type: "remove-local-images",
        videoId: "video-1",
        filePaths: ["/v/a.png"],
      },
      { type: "report-saved", body: "![a](https://c/a.png)" },
    ]);
  });

  it("removes only the files that went into the body, and only when asked", () => {
    // The author deleted b from the body while the Job ran.
    const edited = "Typed meanwhile.\n![a](a.png)";
    const swapped = swapImageUploads(edited, [
      { ref: "a.png", filePath: "/v/a.png", url: "https://c/a.png" },
      { ref: "b.png", filePath: "/v/b.png", url: "https://c/b.png" },
    ]);
    expect(swapped.body).toBe("Typed meanwhile.\n![a](https://c/a.png)");

    const saved = (deleteLocalFiles: boolean, swappedFilePaths: string[]) =>
      tester()
        .send({
          type: "body-saved",
          videoId: "video-1",
          savedBody: swapped.body,
          swappedFilePaths,
          deleteLocalFiles,
        })
        .getEffects()
        .filter((e) => e.type === "remove-local-images");
    expect(saved(true, swapped.swappedFilePaths)).toEqual([
      {
        type: "remove-local-images",
        videoId: "video-1",
        filePaths: ["/v/a.png"],
      },
    ]);
    expect(saved(false, swapped.swappedFilePaths)).toEqual([]);
    expect(saved(true, [])).toEqual([]);
  });
});
