import type { uploadReducer } from "./upload-reducer";

export function hasActiveExportUploads(
  uploads: Record<string, uploadReducer.UploadEntry>
): boolean {
  return Object.values(uploads).some(
    (u) =>
      u.uploadType === "export" &&
      (u.status === "uploading" ||
        u.status === "waiting" ||
        u.status === "retrying")
  );
}
