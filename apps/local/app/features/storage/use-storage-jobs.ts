import { useContext, useEffect } from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  observedStorageJobs,
  storageJobsOf,
  type ObservedStorageJob,
} from "./storage-jobs";

/**
 * The bridge from the tab's Job Events to a Storage page (#2157): the
 * storage Jobs it can see (every one, or one bucket's), drawn live, and
 * the Cancel the Upload Manager uses. It tells the page's reducer which
 * are live, only when that changes; the reducer decides to count again.
 */
export const useStorageJobs = (
  bucketId: string | null,
  labelOf: (location: string) => string,
  dispatch: (action: {
    type: "storage-jobs-observed";
    jobs: ObservedStorageJob[];
  }) => void
) => {
  const { jobs, cancelJob } = useContext(UploadContext);
  const views = storageJobsOf(jobs, bucketId, labelOf);
  const observed = observedStorageJobs(views);
  const key = observed.map((j) => `${j.id}:${j.live}`).join(",");
  useEffect(() => {
    dispatch({ type: "storage-jobs-observed", jobs: observed });
    // Only when which Jobs are live changes: `key` says exactly that.
  }, [key, dispatch]);
  return { views, cancelJob };
};
