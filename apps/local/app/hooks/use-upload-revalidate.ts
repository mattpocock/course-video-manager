import { useContext, useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { uploadReducer } from "@/features/upload-manager/upload-reducer";

type UploadSnapshot = Record<
  string,
  { status: uploadReducer.UploadStatus; uploadType: uploadReducer.UploadType }
>;

export function hasNewSuccessForTypes(
  prev: UploadSnapshot,
  current: UploadSnapshot,
  types: Set<uploadReducer.UploadType>
): boolean {
  for (const [id, upload] of Object.entries(current)) {
    const prevUpload = prev[id];
    if (!prevUpload) continue;
    if (prevUpload.status === upload.status) continue;
    if (upload.status === "success" && types.has(upload.uploadType)) {
      return true;
    }
  }
  return false;
}

export function useUploadRevalidate(uploadTypes: uploadReducer.UploadType[]) {
  const { uploads } = useContext(UploadContext);
  const revalidator = useRevalidator();
  const previousRef = useRef(uploads);
  const typesRef = useRef(new Set<uploadReducer.UploadType>(uploadTypes));

  useEffect(() => {
    if (hasNewSuccessForTypes(previousRef.current, uploads, typesRef.current)) {
      revalidator.revalidate();
    }
    previousRef.current = uploads;
  }, [uploads, revalidator]);
}
