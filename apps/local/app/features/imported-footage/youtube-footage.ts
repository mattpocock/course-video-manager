import path from "node:path";

/**
 * IMPORTED FOOTAGE FROM A YOUTUBE URL (#2545). Pure: shared by
 * `cvm footage import <url>`, the Imported Footage page and the
 * `import-youtube-footage` Job.
 *
 * A YouTube import is named `<title, made filename-safe> [<video id>].mp4`,
 * so the video id in the name is what says it is already imported: a second
 * import of the same id reuses that file. Its title and URL are kept beside
 * it, in `<file>.youtube.json` ({@link YoutubeSource}), one of its
 * companions like its transcript.
 */

/** Where an import came from, kept beside it as `<file>.youtube.json`. */
export interface YoutubeSource {
  readonly url: string;
  readonly title: string;
  readonly videoId: string;
}

export const YOUTUBE_SOURCE_SUFFIX = ".youtube.json";

/** The companion that holds a YouTube import's {@link YoutubeSource}. */
export const youtubeSourcePathFor = (footage: string): string =>
  `${footage}${YOUTUBE_SOURCE_SUFFIX}`;

/** A YouTube video id: 11 characters of A-Z, a-z, 0-9, `-` and `_`. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

/** Whether an argument is a web URL rather than a file. */
export const isWebUrl = (arg: string): boolean => /^https?:\/\//i.test(arg);

/**
 * The video id of a YouTube video URL (`watch?v=`, `youtu.be/`, `shorts/`,
 * `live/`, `embed/`), or null when it is not one.
 */
export const youtubeVideoIdOf = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  const id =
    host === "youtu.be"
      ? segments[0]
      : YOUTUBE_HOSTS.has(host)
        ? segments[0] === "watch"
          ? parsed.searchParams.get("v")
          : ["shorts", "live", "embed"].includes(segments[0] ?? "")
            ? segments[1]
            : null
        : null;
  return id && VIDEO_ID.test(id) ? id : null;
};

/** The one URL an import downloads, whatever form it was pasted in. */
export const youtubeWatchUrl = (videoId: string): string =>
  `https://www.youtube.com/watch?v=${videoId}`;

/** Characters no Windows or Linux file name may hold, and control codes. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_TITLE_CHARS = 120;

/**
 * The file name a YouTube import gets: its title made filename-safe (no
 * character Windows refuses, no trailing dot or space, at most 120
 * characters), then its video id in brackets.
 */
export const youtubeFootageName = (title: string, videoId: string): string => {
  const safe = title
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .replace(/[. ]+$/, "");
  return `${safe || "YouTube video"} [${videoId}].mp4`;
};

/** Whether a footage path is the import of this video id. */
export const isYoutubeFootageOf = (footage: string, videoId: string): boolean =>
  path.posix.basename(footage).endsWith(`[${videoId}].mp4`);
