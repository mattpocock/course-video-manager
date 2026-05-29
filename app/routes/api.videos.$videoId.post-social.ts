import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { runtimeLive } from "@/services/layer.server";
import { Command } from "@effect/platform";
import { Data, Effect } from "effect";
import * as fs from "fs";
import * as path from "path";
import type { Route } from "./+types/api.videos.$videoId.post-social";

class SocialPostError extends Data.TaggedError("SocialPostError")<{
  message: string;
}> {}

const COPY_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks for progress reporting
const SYNC_POLL_INTERVAL_MS = 5_000; // 5 seconds
const SYNC_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Copy a file to the destination with progress reporting.
 * Reports progress as a percentage (0-100).
 */
const copyFileWithProgress = (opts: {
  sourcePath: string;
  destPath: string;
  onProgress: (percentage: number) => void;
}) =>
  Effect.gen(function* () {
    const stat = yield* Effect.try({
      try: () => fs.statSync(opts.sourcePath),
      catch: () =>
        new SocialPostError({
          message: `Video file not found: ${opts.sourcePath}`,
        }),
    });

    const fileSize = stat.size;
    opts.onProgress(0);

    // Ensure destination directory exists
    yield* Effect.try({
      try: () => fs.mkdirSync(path.dirname(opts.destPath), { recursive: true }),
      catch: () =>
        new SocialPostError({
          message: `Failed to create destination directory: ${path.dirname(opts.destPath)}`,
        }),
    });

    yield* Effect.acquireUseRelease(
      // Acquire: open both file handles
      Effect.try({
        try: () => ({
          readFd: fs.openSync(opts.sourcePath, "r"),
          writeFd: fs.openSync(opts.destPath, "w"),
        }),
        catch: () =>
          new SocialPostError({ message: "Failed to open files for copy" }),
      }),
      // Use: copy in chunks
      ({ readFd, writeFd }) =>
        Effect.gen(function* () {
          let offset = 0;
          const buffer = Buffer.alloc(COPY_CHUNK_SIZE);

          while (offset < fileSize) {
            const chunkSize = Math.min(COPY_CHUNK_SIZE, fileSize - offset);
            const bytesRead = yield* Effect.try({
              try: () => fs.readSync(readFd, buffer, 0, chunkSize, offset),
              catch: () =>
                new SocialPostError({ message: "Failed to read video file" }),
            });

            yield* Effect.try({
              try: () => fs.writeSync(writeFd, buffer, 0, bytesRead),
              catch: () =>
                new SocialPostError({
                  message: "Failed to write to destination",
                }),
            });

            offset += bytesRead;
            opts.onProgress(Math.round((offset / fileSize) * 100));
          }
        }),
      // Release: close file handles
      ({ readFd, writeFd }) =>
        Effect.sync(() => {
          fs.closeSync(readFd);
          fs.closeSync(writeFd);
        })
    );
  });

/**
 * Poll `dropbox filestatus` until the file reports as synced.
 * Throws SocialPostError if the timeout is exceeded.
 */
const waitForDropboxSync = (opts: {
  filePath: string;
  onStatus: (status: string) => void;
}) =>
  Effect.gen(function* () {
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
        return yield* new SocialPostError({
          message: `Dropbox sync timed out after 30 minutes for: ${opts.filePath}`,
        });
      }

      const command = Command.make(
        "dropbox",
        "filestatus",
        path.basename(opts.filePath)
      ).pipe(Command.workingDirectory(path.dirname(opts.filePath)));

      const result = yield* Command.string(command).pipe(
        Effect.catchAllCause((e) =>
          Effect.fail(
            new SocialPostError({
              message: `Failed to execute Dropbox filestatus command: ${e instanceof Error ? e.message : String(e)}`,
            })
          )
        )
      );

      yield* Effect.log(`[dropbox filestatus] ${opts.filePath}: ${result}`);

      opts.onStatus(result);

      // "up to date" means synced to Dropbox cloud
      if (result.toLowerCase().includes("up to date")) {
        return;
      }

      yield* Effect.sleep(SYNC_POLL_INTERVAL_MS);
    }
  });

/**
 * Send HTTP POST to Zapier webhook with caption and Dropbox file path.
 */
const sendZapierWebhook = (opts: {
  webhookUrl: string;
  caption: string;
  dropboxFilePath: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: opts.caption,
          dropboxFilePath: path.basename(opts.dropboxFilePath),
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Zapier webhook failed (${res.status}): ${errorText}`);
      }
      console.log("[sendZapierWebhook]", await res.text());
    },
    catch: (e) =>
      new SocialPostError({
        message: `Failed to send Zapier webhook: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const caption: string = body.caption;

  if (!caption) {
    return Response.json({ error: "Caption is required" }, { status: 400 });
  }

  const bufferPostsPath = process.env.BUFFER_POSTS_PATH;
  const zapierWebhookUrl = process.env.ZAPIER_BUFFER_WEBHOOK_URL;

  if (!bufferPostsPath) {
    return Response.json(
      { error: "BUFFER_POSTS_PATH environment variable is not configured" },
      { status: 500 }
    );
  }

  if (!zapierWebhookUrl) {
    return Response.json(
      {
        error:
          "ZAPIER_BUFFER_WEBHOOK_URL environment variable is not configured",
      },
      { status: 500 }
    );
  }

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        const sourcePath = yield* publishService.resolveExportPath(videoId);

        if (!sourcePath) {
          return yield* new SocialPostError({
            message: "Video has not been exported",
          });
        }

        const destFilename = path.basename(sourcePath);
        const destPath = path.join(bufferPostsPath, destFilename);

        // Stage 1: Copy file to Dropbox folder
        sendEvent("copying", { percentage: 0 });

        yield* copyFileWithProgress({
          sourcePath,
          destPath,
          onProgress: (percentage) => {
            sendEvent("copying", { percentage });
          },
        });

        // Stage 2: Poll Dropbox file status until synced
        sendEvent("syncing", { status: "Waiting for Dropbox sync..." });

        yield* waitForDropboxSync({
          filePath: destPath,
          onStatus: (status) => {
            sendEvent("syncing", { status });
          },
        });

        // Stage 3: Send webhook to Zapier
        sendEvent("sending-webhook", {});

        yield* sendZapierWebhook({
          webhookUrl: zapierWebhookUrl,
          caption,
          dropboxFilePath: destPath,
        });

        // Done
        sendEvent("complete", {});
      }),
    errorHandlers: [
      {
        tag: "SocialPostError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
    ],
    fallbackMessage: "Social post failed unexpectedly",
  });
};
