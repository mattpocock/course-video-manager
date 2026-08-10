import { Config, ConfigProvider, Data, Effect, Schedule } from "effect";
import { statSync } from "fs";
import * as fs from "fs";
import { getAiHeroAccessToken } from "@/services/ai-hero-auth-service";

export class AiHeroUploadError extends Data.TaggedError("AiHeroUploadError")<{
  message: string;
  code?: string;
}> {}

const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks
const MAX_RETRIES = 5;
const MAX_CONCURRENT_PARTS = 4;

/**
 * Step 1: Create a multipart upload session.
 */
const createMultipartUpload = (opts: {
  baseUrl: string;
  accessToken: string;
  filename: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${opts.baseUrl}/api/uploads/multipart/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: opts.filename }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to create multipart upload (${res.status}): ${errorText}`
        );
      }

      return (await res.json()) as {
        uploadId: string;
        key: string;
        publicUrl: string;
      };
    },
    catch: (e) =>
      new AiHeroUploadError({
        message:
          e instanceof Error ? e.message : "Failed to create multipart upload",
        code: "multipart_create_failed",
      }),
  });

/**
 * Get a presigned URL for uploading a single part.
 */
const getPartUrl = (opts: {
  baseUrl: string;
  accessToken: string;
  key: string;
  uploadId: string;
  partNumber: number;
}) =>
  Effect.tryPromise({
    try: async () => {
      const params = new URLSearchParams({
        key: opts.key,
        uploadId: opts.uploadId,
        partNumber: opts.partNumber.toString(),
      });
      const res = await fetch(
        `${opts.baseUrl}/api/uploads/multipart/part-url?${params}`,
        {
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
          },
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get part URL (${res.status}): ${errorText}`);
      }

      return (await res.json()) as { signedUrl: string; partNumber: number };
    },
    catch: (e) =>
      new AiHeroUploadError({
        message:
          e instanceof Error ? e.message : "Failed to get part upload URL",
        code: "part_url_failed",
      }),
  });

/**
 * Upload a single chunk to S3 with exponential backoff retry.
 */
const uploadPart = (opts: {
  signedUrl: string;
  buffer: Buffer;
  retries?: number;
}): Effect.Effect<string, AiHeroUploadError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(opts.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": opts.buffer.length.toString(),
        },
        body: opts.buffer as unknown as BodyInit,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Part upload failed (${res.status}): ${errorText}`);
      }

      const etag = res.headers.get("ETag");
      if (!etag) {
        throw new Error("No ETag in part upload response");
      }

      return etag;
    },
    catch: (e) =>
      new AiHeroUploadError({
        message: e instanceof Error ? e.message : "Part upload failed",
        code: "part_upload_failed",
      }),
  }).pipe(
    Effect.retry(
      Schedule.intersect(
        Schedule.union(
          Schedule.exponential("1 second", 2),
          Schedule.spaced("30 seconds")
        ),
        Schedule.recurs(opts.retries ?? MAX_RETRIES)
      )
    )
  );

/**
 * Complete the multipart upload by sending all part ETags.
 */
const completeMultipartUpload = (opts: {
  baseUrl: string;
  accessToken: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(
        `${opts.baseUrl}/api/uploads/multipart/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key: opts.key,
            uploadId: opts.uploadId,
            parts: opts.parts,
          }),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to complete multipart upload (${res.status}): ${errorText}`
        );
      }

      return (await res.json()) as { publicUrl: string; key: string };
    },
    catch: (e) =>
      new AiHeroUploadError({
        message:
          e instanceof Error
            ? e.message
            : "Failed to complete multipart upload",
        code: "multipart_complete_failed",
      }),
  });

/**
 * Upload a file to S3 using multipart upload with chunking, concurrency, and retries.
 */
const uploadFileMultipart = (opts: {
  baseUrl: string;
  accessToken: string;
  filePath: string;
  fileSize: number;
  key: string;
  uploadId: string;
  onProgress?: (percentage: number) => void;
}) =>
  Effect.acquireUseRelease(
    // Acquire: open file handle
    Effect.tryPromise({
      try: () => fs.promises.open(opts.filePath, "r"),
      catch: () =>
        new AiHeroUploadError({
          message: "Failed to open video file",
          code: "file_open_error",
        }),
    }),
    // Use: upload all parts in batches
    (fileHandle) =>
      Effect.gen(function* () {
        const totalParts = Math.ceil(opts.fileSize / CHUNK_SIZE);
        const completedParts: Array<{ partNumber: number; etag: string }> = [];
        let partsUploaded = 0;

        for (
          let batchStart = 0;
          batchStart < totalParts;
          batchStart += MAX_CONCURRENT_PARTS
        ) {
          const batchEnd = Math.min(
            batchStart + MAX_CONCURRENT_PARTS,
            totalParts
          );
          const batchEffects: Array<
            Effect.Effect<
              { partNumber: number; etag: string },
              AiHeroUploadError
            >
          > = [];

          for (let i = batchStart; i < batchEnd; i++) {
            const partNumber = i + 1; // 1-indexed
            const offset = i * CHUNK_SIZE;
            const chunkSize = Math.min(CHUNK_SIZE, opts.fileSize - offset);

            const partEffect = Effect.gen(function* () {
              const buffer = Buffer.alloc(chunkSize);
              yield* Effect.tryPromise({
                try: () => fileHandle.read(buffer, 0, chunkSize, offset),
                catch: () =>
                  new AiHeroUploadError({
                    message: `Failed to read chunk at offset ${offset}`,
                    code: "file_read_error",
                  }),
              });

              const { signedUrl } = yield* getPartUrl({
                baseUrl: opts.baseUrl,
                accessToken: opts.accessToken,
                key: opts.key,
                uploadId: opts.uploadId,
                partNumber,
              });

              const etag = yield* uploadPart({ signedUrl, buffer });

              return { partNumber, etag };
            });

            batchEffects.push(partEffect);
          }

          const batchResults = yield* Effect.all(batchEffects, {
            concurrency: MAX_CONCURRENT_PARTS,
          });
          for (const result of batchResults) {
            completedParts.push(result);
            partsUploaded++;
            opts.onProgress?.(Math.round((partsUploaded / totalParts) * 100));
          }
        }

        completedParts.sort((a, b) => a.partNumber - b.partNumber);
        return completedParts;
      }),
    // Release: close file handle
    (fileHandle) => Effect.promise(() => fileHandle.close())
  );

/**
 * Step 3: Create a post on AI Hero with the given title.
 * Returns the post object including its slug and id.
 */
const createPost = (opts: {
  baseUrl: string;
  accessToken: string;
  title: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${opts.baseUrl}/api/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: opts.title,
          postType: "article",
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to create post (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as { id: string; slug: string };
      return data;
    },
    catch: (e) =>
      new AiHeroUploadError({
        message: e instanceof Error ? e.message : "Failed to create post",
        code: "create_post_failed",
      }),
  });

/**
 * Step 4: Trigger video processing on AI Hero by registering the S3 upload.
 */
const triggerVideoProcessing = (opts: {
  baseUrl: string;
  accessToken: string;
  mediaUrl: string;
  fileName: string;
  postId: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${opts.baseUrl}/api/uploads/new`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: {
            url: opts.mediaUrl,
            name: opts.fileName,
          },
          metadata: {
            parentResourceId: opts.postId,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to trigger video processing (${res.status}): ${errorText}`
        );
      }
    },
    catch: (e) =>
      new AiHeroUploadError({
        message:
          e instanceof Error ? e.message : "Failed to trigger video processing",
        code: "video_processing_failed",
      }),
  });

/**
 * Step 5: Update the post with body and description.
 */
const updatePost = (opts: {
  baseUrl: string;
  accessToken: string;
  postId: string;
  title: string;
  slug: string;
  body: string;
  description: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(
        `${opts.baseUrl}/api/posts?id=${encodeURIComponent(opts.postId)}&action=save`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: opts.postId,
            fields: {
              title: opts.title,
              slug: opts.slug,
              body: opts.body,
              description: opts.description,
            },
            tags: [],
          }),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to update post (${res.status}): ${errorText}`);
      }
    },
    catch: (e) =>
      new AiHeroUploadError({
        message: e instanceof Error ? e.message : "Failed to update post",
        code: "update_post_failed",
      }),
  });

/**
 * Step 6: Publish the post on AI Hero.
 */
const publishPost = (opts: {
  baseUrl: string;
  accessToken: string;
  postId: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(
        `${opts.baseUrl}/api/posts?id=${encodeURIComponent(opts.postId)}&action=publish`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to publish post (${res.status}): ${errorText}`);
      }
    },
    catch: (e) =>
      new AiHeroUploadError({
        message: e instanceof Error ? e.message : "Failed to publish post",
        code: "publish_post_failed",
      }),
  });

/**
 * Create a Skills Changelog entry on AI Hero with all article + newsletter fields,
 * published immediately. Returns the final (server-prefixed) slug and resource id.
 */
const createSkillsChangelog = (opts: {
  baseUrl: string;
  accessToken: string;
  title: string;
  slug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${opts.baseUrl}/api/skills/changelog`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: opts.title,
          slug: opts.slug,
          description: opts.description,
          body: opts.body,
          newsletterCopy: opts.newsletterCopy,
          newsletterSubject: opts.newsletterSubject,
          newsletterPreviewText: opts.newsletterPreviewText,
          state: "published",
          visibility: "public",
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to create skills changelog (${res.status}): ${errorText}`
        );
      }

      const data = (await res.json()) as { id: string; slug: string };
      return data;
    },
    catch: (e) =>
      new AiHeroUploadError({
        message:
          e instanceof Error ? e.message : "Failed to create skills changelog",
        code: "create_skills_changelog_failed",
      }),
  });

/**
 * Full Skills Changelog posting flow:
 * 1. Create multipart upload
 * 2. Upload video to S3 in chunks
 * 3. Complete multipart upload
 * 4. POST /api/skills/changelog (published immediately, creates Kit draft)
 * 5. Trigger video processing with parentResourceId = changelog id
 * 6. Return server-prefixed slug
 */
export const postSkillsChangelogToAiHero = (opts: {
  filePath: string;
  title: string;
  slug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
  onProgress?: (percentage: number) => void;
}) =>
  Effect.gen(function* () {
    const baseUrl = yield* Config.string("AI_HERO_BASE_URL");
    const accessToken = yield* getAiHeroAccessToken;

    const fileSize = yield* Effect.try({
      try: () => statSync(opts.filePath).size,
      catch: () =>
        new AiHeroUploadError({
          message: `Video file not found: ${opts.filePath}`,
          code: "file_not_found",
        }),
    });

    const filename = opts.filePath.split("/").pop() ?? "video.mp4";

    yield* Effect.logInfo("Creating multipart upload");
    const multipart = yield* createMultipartUpload({
      baseUrl,
      accessToken,
      filename,
    });

    yield* Effect.logInfo(
      `Uploading video to S3 (${(fileSize / (1024 * 1024)).toFixed(0)}MB, ${Math.ceil(fileSize / CHUNK_SIZE)} parts)`
    );
    const parts = yield* uploadFileMultipart({
      baseUrl,
      accessToken,
      filePath: opts.filePath,
      fileSize,
      key: multipart.key,
      uploadId: multipart.uploadId,
      onProgress: opts.onProgress,
    });

    yield* Effect.logInfo("Completing multipart upload");
    const completed = yield* completeMultipartUpload({
      baseUrl,
      accessToken,
      key: multipart.key,
      uploadId: multipart.uploadId,
      parts,
    });

    yield* Effect.logInfo("Creating skills changelog on AI Hero");
    const changelog = yield* createSkillsChangelog({
      baseUrl,
      accessToken,
      title: opts.title,
      slug: opts.slug,
      body: opts.body,
      description: opts.description,
      newsletterSubject: opts.newsletterSubject,
      newsletterPreviewText: opts.newsletterPreviewText,
      newsletterCopy: opts.newsletterCopy,
    });

    yield* Effect.logInfo("Triggering video processing");
    yield* triggerVideoProcessing({
      baseUrl,
      accessToken,
      mediaUrl: completed.publicUrl,
      fileName: filename,
      postId: changelog.id,
    });

    yield* Effect.logInfo(
      `Skills Changelog published. Slug: ${changelog.slug}`
    );

    return { slug: changelog.slug };
  }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));

/**
 * Full AI Hero posting flow:
 * 1. Create multipart upload
 * 2. Upload video to S3 in chunks (with progress)
 * 3. Complete multipart upload
 * 4. Create post
 * 5. Trigger video processing
 * 6. Update post with body + description
 * 7. Publish post
 * 8. Return slug
 */
export const postToAiHero = (opts: {
  filePath: string;
  title: string;
  body: string;
  description: string;
  slug: string;
  onProgress?: (percentage: number) => void;
}) =>
  Effect.gen(function* () {
    const baseUrl = yield* Config.string("AI_HERO_BASE_URL");
    const accessToken = yield* getAiHeroAccessToken;

    const fileSize = yield* Effect.try({
      try: () => statSync(opts.filePath).size,
      catch: () =>
        new AiHeroUploadError({
          message: `Video file not found: ${opts.filePath}`,
          code: "file_not_found",
        }),
    });

    // Derive filename from file path
    const filename = opts.filePath.split("/").pop() ?? "video.mp4";

    // Step 1: Create multipart upload
    yield* Effect.logInfo("Creating multipart upload");
    const multipart = yield* createMultipartUpload({
      baseUrl,
      accessToken,
      filename,
    });

    // Step 2: Upload video to S3 in chunks
    yield* Effect.logInfo(
      `Uploading video to S3 (${(fileSize / (1024 * 1024)).toFixed(0)}MB, ${Math.ceil(fileSize / CHUNK_SIZE)} parts)`
    );
    const parts = yield* uploadFileMultipart({
      baseUrl,
      accessToken,
      filePath: opts.filePath,
      fileSize,
      key: multipart.key,
      uploadId: multipart.uploadId,
      onProgress: opts.onProgress,
    });

    // Step 3: Complete multipart upload
    yield* Effect.logInfo("Completing multipart upload");
    const completed = yield* completeMultipartUpload({
      baseUrl,
      accessToken,
      key: multipart.key,
      uploadId: multipart.uploadId,
      parts,
    });

    // Step 4: Create post
    yield* Effect.logInfo("Creating post on AI Hero");
    const post = yield* createPost({
      baseUrl,
      accessToken,
      title: opts.title,
    });

    // Step 5: Trigger video processing
    yield* Effect.logInfo("Triggering video processing");
    yield* triggerVideoProcessing({
      baseUrl,
      accessToken,
      mediaUrl: completed.publicUrl,
      fileName: filename,
      postId: post.id,
    });

    // Step 6: Update post with body, description, and slug
    const finalSlug = opts.slug || post.slug;
    yield* Effect.logInfo("Updating post with body, description, and slug");
    yield* updatePost({
      baseUrl,
      accessToken,
      postId: post.id,
      title: opts.title,
      slug: finalSlug,
      body: opts.body,
      description: opts.description,
    });

    // Step 7: Publish post
    yield* Effect.logInfo("Publishing post");
    yield* publishPost({
      baseUrl,
      accessToken,
      postId: post.id,
    });

    yield* Effect.logInfo(`AI Hero post published. Slug: ${finalSlug}`);

    return { slug: finalSlug };
  }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));
