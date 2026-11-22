import { now } from "@/packages/clock";

/**
 * Creating a **Short**: one standalone Short, made by `POST /api/videos/create`
 * and opened in its editor. The sidebar, `/shorts` and the Video editor's
 * New Short all submit this.
 */
export const NEW_SHORT_ACTION = "/api/videos/create";

/**
 * The search param on a Short's editor URL naming the Video it was created
 * from. Its back button returns there, ahead of its usual back target.
 */
export const RETURN_TO_VIDEO_PARAM = "returnTo";

/** The editor of the Video this page was opened from, if its URL names one. */
export const returnToVideoUrl = (search: URLSearchParams): string | null => {
  const videoId = search.get(RETURN_TO_VIDEO_PARAM);
  return videoId ? `/videos/${encodeURIComponent(videoId)}/edit` : null;
};

/**
 * The form `POST /api/videos/create` takes for a new Short. With
 * `returnToVideoId`, the Short's editor opens with a back button to that
 * Video. No Recorder: a Short records with the CVM recorder only (ADR 0037).
 */
export const newShortFormData = (
  opts: { returnToVideoId?: string } = {}
): FormData => {
  const formData = new FormData();
  formData.set("title", `Short ${now().toLocaleDateString()}`);
  formData.set("format", "short");
  formData.set(
    "redirectTo",
    opts.returnToVideoId
      ? `/videos/{id}/edit?${RETURN_TO_VIDEO_PARAM}=${encodeURIComponent(opts.returnToVideoId)}`
      : "/videos/{id}/edit"
  );
  return formData;
};
