/**
 * Creating a Video to stream into: one standalone Landscape Video, made by
 * `POST /api/videos/create` and opened on the Streaming tab, as Shorts' "+"
 * creates a Short. The sidebar and `/streaming` both submit this.
 */
export const NEW_STREAM_VIDEO_ACTION = "/api/videos/create";

/** The Streaming tab for one Video. */
export const streamingUrl = (videoId: string): string =>
  `/streaming/${encodeURIComponent(videoId)}`;

/** The form `POST /api/videos/create` takes for a new Video to stream into. */
export const newStreamVideoFormData = (): FormData => {
  const formData = new FormData();
  formData.set("title", `Stream ${new Date().toLocaleDateString()}`);
  formData.set("format", "landscape");
  formData.set("redirectTo", "/streaming/{id}");
  return formData;
};
