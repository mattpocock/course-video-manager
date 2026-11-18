/**
 * A Video's **post visibility**: picked on the Post page (YouTube's privacy
 * status), kept in this browser per Video, and read by the AI Hero page so
 * the AI Hero post goes out the same way. Nothing picked means unlisted, the
 * Post page's own default.
 */
export type PostVisibility = "public" | "unlisted";

export const DEFAULT_POST_VISIBILITY: PostVisibility = "unlisted";

export const POST_VISIBILITY_STORAGE_KEY = (videoId: string) =>
  `post-visibility-${videoId}`;

/** A stored value as a visibility; anything unreadable is null. */
export const parsePostVisibility = (
  raw: string | null
): PostVisibility | null =>
  raw === "public" || raw === "unlisted" ? raw : null;
