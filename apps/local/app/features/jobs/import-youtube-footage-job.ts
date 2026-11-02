/**
 * The `import-youtube-footage` Job (`sidecar/kinds/import-youtube-footage.ts`),
 * as `cvm footage import <youtube-url>` and the Imported Footage page know it:
 * it downloads one YouTube video with `yt-dlp`, refuses it unless it is 16:9,
 * copies it in as Imported Footage, then enqueues its `transcribe-footage`
 * Job. Its subject is `{ type: "youtube", id: <video id> }`. Its `progress`
 * events carry the download's percent; it ends with a
 * `footage-imported` event, as an `import-footage` Job does.
 */
export const IMPORT_YOUTUBE_FOOTAGE_JOB_KIND = "import-youtube-footage";

export const YOUTUBE_SUBJECT_TYPE = "youtube";
