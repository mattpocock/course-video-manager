import { Data, Effect } from "effect";
import { statSync } from "fs";
import * as fs from "fs";

export class YouTubeUploadError extends Data.TaggedError("YouTubeUploadError")<{
  message: string;
  code?: string;
}> {}

// YouTube requires chunks to be multiples of 256KB
const CHUNK_SIZE = 256 * 1024 * 16; // 4MB chunks

/**
 * Initiate a resumable upload session with YouTube Data API v3.
 * Returns the upload URI from the Location header.
 */
const initiateResumableUpload = (opts: {
  accessToken: string;
  title: string;
  description: string;
  privacyStatus: "public" | "unlisted";
  notifySubscribers: boolean;
  fileSize: number;
}) =>
  Effect.tryPromise({
    try: async () => {
      const url = new URL(
        "https://www.googleapis.com/upload/youtube/v3/videos"
      );
      url.searchParams.set("uploadType", "resumable");
      url.searchParams.set("part", "snippet,status");
      url.searchParams.set("notifySubscribers", String(opts.notifySubscribers));

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": opts.fileSize.toString(),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: opts.title,
            description: opts.description,
          },
          status: {
            privacyStatus: opts.privacyStatus,
            selfDeclaredMadeForKids: false,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to initiate upload (${res.status}): ${errorText}`
        );
      }

      const uploadUri = res.headers.get("location");
      if (!uploadUri) {
        throw new Error("No upload URI in response");
      }

      return uploadUri;
    },
    catch: (e) =>
      new YouTubeUploadError({
        message: e instanceof Error ? e.message : "Failed to initiate upload",
        code: "initiate_failed",
      }),
  });

/**
 * Upload a video file to YouTube using the resumable upload protocol.
 * Calls onProgress with the percentage (0-100) after each chunk.
 * Returns the YouTube video ID on success.
 */
export const uploadVideoToYouTube = (opts: {
  accessToken: string;
  filePath: string;
  title: string;
  description: string;
  privacyStatus: "public" | "unlisted";
  notifySubscribers: boolean;
  onProgress: (percentage: number) => void;
}) =>
  Effect.gen(function* () {
    const fileSize = yield* Effect.try({
      try: () => statSync(opts.filePath).size,
      catch: () =>
        new YouTubeUploadError({
          message: `Video file not found: ${opts.filePath}`,
          code: "file_not_found",
        }),
    });

    opts.onProgress(0);

    const uploadUri = yield* initiateResumableUpload({
      accessToken: opts.accessToken,
      title: opts.title,
      description: opts.description,
      privacyStatus: opts.privacyStatus,
      notifySubscribers: opts.notifySubscribers,
      fileSize,
    });

    yield* Effect.logInfo("Resumable upload initiated");

    const result = yield* Effect.acquireUseRelease(
      // Acquire: open file handle
      Effect.tryPromise({
        try: () => fs.promises.open(opts.filePath, "r"),
        catch: () =>
          new YouTubeUploadError({
            message: "Failed to open video file",
            code: "file_open_error",
          }),
      }),
      // Use: upload in chunks
      (fileHandle) =>
        Effect.gen(function* () {
          let offset = 0;

          while (offset < fileSize) {
            const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
            const chunkEnd = offset + chunkSize;

            const buffer = Buffer.alloc(chunkSize);
            yield* Effect.tryPromise({
              try: () => fileHandle.read(buffer, 0, chunkSize, offset),
              catch: () =>
                new YouTubeUploadError({
                  message: "Failed to read video file chunk",
                  code: "file_read_error",
                }),
            });

            const response = yield* Effect.tryPromise({
              try: async () => {
                const res = await fetch(uploadUri, {
                  method: "PUT",
                  headers: {
                    "Content-Length": chunkSize.toString(),
                    "Content-Range": `bytes ${offset}-${chunkEnd - 1}/${fileSize}`,
                    "Content-Type": "video/mp4",
                  },
                  body: buffer,
                });

                // 308 Resume Incomplete = chunk received, more expected
                if (res.status === 308) {
                  return { complete: false as const };
                }

                // 200 or 201 = upload complete
                if (res.ok) {
                  const data = await res.json();
                  return {
                    complete: true as const,
                    data: data as { id: string },
                  };
                }

                const errorText = await res.text();
                throw new Error(
                  `Upload chunk failed (${res.status}): ${errorText}`
                );
              },
              catch: (e) =>
                new YouTubeUploadError({
                  message:
                    e instanceof Error ? e.message : "Upload chunk failed",
                  code: "upload_failed",
                }),
            });

            offset = chunkEnd;
            opts.onProgress(Math.round((offset / fileSize) * 100));

            if (response.complete) {
              return response.data;
            }
          }

          return yield* new YouTubeUploadError({
            message: "Upload completed without response from YouTube",
            code: "no_response",
          });
        }),
      // Release: close file handle
      (fileHandle) => Effect.promise(() => fileHandle.close())
    );

    yield* Effect.logInfo(`YouTube upload complete. Video ID: ${result.id}`);

    return { videoId: result.id };
  });

/**
 * Set a custom thumbnail on a YouTube video using the thumbnails.set endpoint.
 * Reads the PNG file from disk and uploads it as the video's thumbnail.
 */
export const setYouTubeThumbnail = (opts: {
  accessToken: string;
  youtubeVideoId: string;
  thumbnailFilePath: string;
}) =>
  Effect.gen(function* () {
    const fileBuffer = yield* Effect.tryPromise({
      try: () => fs.promises.readFile(opts.thumbnailFilePath),
      catch: () =>
        new YouTubeUploadError({
          message: `Thumbnail file not found: ${opts.thumbnailFilePath}`,
          code: "thumbnail_file_not_found",
        }),
    });

    yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(opts.youtubeVideoId)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${opts.accessToken}`,
              "Content-Type": "image/png",
              "Content-Length": fileBuffer.length.toString(),
            },
            body: fileBuffer,
          }
        );

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(
            `Failed to set thumbnail (${res.status}): ${errorText}`
          );
        }

        return await res.json();
      },
      catch: (e) =>
        new YouTubeUploadError({
          message: e instanceof Error ? e.message : "Failed to set thumbnail",
          code: "set_thumbnail_failed",
        }),
    });

    yield* Effect.logInfo(
      `YouTube thumbnail set for video ${opts.youtubeVideoId}`
    );
  });
