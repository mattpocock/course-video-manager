import type { uploadReducer } from "./upload-reducer";

const BUFFER_STAGE_LABELS: Record<uploadReducer.BufferStage, string> = {
  "uploading-blob": "Uploading to cloud",
  "creating-post": "Creating Buffer post",
  polling: "Waiting for delivery",
  "cleaning-up": "Cleaning up",
};

const EXPORT_STAGE_LABELS: Record<uploadReducer.ExportStage, string> = {
  queued: "Queued",
  "concatenating-clips": "Concatenating clips",
  "normalizing-audio": "Normalizing audio",
};

const VIDEO_UPLOAD_STAGE_LABELS: Record<
  uploadReducer.VideoUploadStage,
  string
> = {
  "queued-for-upload": "Waiting to upload",
  uploading: "Uploading to Dropbox",
};

const PUBLISH_STAGE_LABELS: Record<uploadReducer.PublishStage, string> = {
  validating: "Validating",
  exporting: "Exporting videos",
  uploading: "Uploading to Dropbox",
  freezing: "Freezing version",
  cloning: "Creating new draft",
  complete: "Finishing up",
};

const AUTOFILL_STAGE_LABELS: Record<uploadReducer.AutofillStage, string> = {
  selecting: "Choosing videos",
  writing: "Writing missing text",
};

const RENDER_VERTICAL_STAGE_LABELS: Record<
  uploadReducer.RenderVerticalStage,
  string
> = {
  "concatenating-clips": "Concatenating clips",
  transcribing: "Transcribing audio",
  "rendering-overlay": "Rendering subtitles",
  compositing: "Compositing video",
};

/**
 * What an in-flight job is doing right now, for the label beside its progress
 * bar. `null` when the job type has no stages (a plain upload streams a real
 * byte percentage, so the bar alone says everything) or when a staged job has
 * not reported its first stage yet.
 */
export function uploadStageLabel(
  upload: uploadReducer.UploadEntry
): string | null {
  switch (upload.uploadType) {
    case "export":
      // A per-Video task under a Publish encodes first and uploads after, so
      // its upload stage — once it has one — is the later word on what it is
      // doing.
      if (upload.videoUploadStage) {
        return VIDEO_UPLOAD_STAGE_LABELS[upload.videoUploadStage];
      }
      return upload.exportStage
        ? EXPORT_STAGE_LABELS[upload.exportStage]
        : null;
    case "publish":
      return upload.publishStage
        ? PUBLISH_STAGE_LABELS[upload.publishStage]
        : null;
    case "autofill":
      return upload.autofillStage
        ? AUTOFILL_STAGE_LABELS[upload.autofillStage]
        : null;
    case "buffer":
      return upload.bufferStage
        ? BUFFER_STAGE_LABELS[upload.bufferStage]
        : null;
    case "render-vertical":
      return upload.renderVerticalStage
        ? RENDER_VERTICAL_STAGE_LABELS[upload.renderVerticalStage]
        : null;
    default:
      return null;
  }
}
