import { getAutoSelectThumbnailId } from "@/features/video-posting/auto-select-thumbnail";
import type { NewBroadcastDraft } from "./broadcast";

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

/**
 * The Video a **New Broadcast** is made for, as its form reads it: with its
 * thumbnails from the thumbnail creator, newest first.
 */
export type NewBroadcastVideo = {
  id: string;
  title: string;
  description: string | null;
  thumbnails: { id: string; selectedForUpload: boolean }[];
};

/** The Video's thumbnail selected for upload, else its only one, else none. */
export const defaultThumbnailId = (video: NewBroadcastVideo): string | null =>
  video.thumbnails.find((t) => t.selectedForUpload)?.id ??
  getAutoSelectThumbnailId(video.thumbnails);

/**
 * What the New Broadcast form starts with for the Video the Streaming tab is
 * open for: its title and description, Unlisted (a stream never goes public
 * by accident), Ultra-low latency (chat replies land quickly) and its
 * thumbnail (`defaultThumbnailId`).
 */
export const newBroadcastDefaults = (
  video: NewBroadcastVideo
): NewBroadcastDraft => ({
  title: video.title,
  description: video.description ?? "",
  privacyStatus: "unlisted",
  latencyPreference: "ultraLow",
  thumbnailId: defaultThumbnailId(video),
});
