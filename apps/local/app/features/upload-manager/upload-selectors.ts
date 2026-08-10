import type { uploadReducer } from "./upload-reducer";

/**
 * The job a page about a single Video should show as that Video's upload.
 *
 * Child tasks are deliberately skipped. A Publish fans out one per-Video task
 * for every Video it ships — carrying that Video's id, and living for the whole
 * Publish — so without this a Publish would make every Video in the course look
 * like it had an upload of its own in flight. A child task speaks for its
 * parent's bar and for nothing else.
 */
export const findVideoUpload = (
  uploads: Record<string, uploadReducer.UploadEntry>,
  videoId: string
): uploadReducer.UploadEntry | undefined =>
  Object.values(uploads).find(
    (upload) => upload.videoId === videoId && !upload.parentUploadId
  );
