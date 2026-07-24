import { Data, Duration, Effect, Schedule } from "effect";
import {
  open as fsOpen,
  readFile as fsReadFile,
  type FileHandle,
} from "node:fs/promises";

export class DropboxApiError extends Data.TaggedError("DropboxApiError")<{
  message: string;
  status?: number;
  endpoint?: string;
}> {}

type DropboxFileMetadata = {
  ".tag": "file";
  name: string;
  path_display: string;
  size: number;
  content_hash: string;
};

type DropboxFolderMetadata = {
  ".tag": "folder";
  name: string;
  path_display: string;
};

type DropboxEntry = DropboxFileMetadata | DropboxFolderMetadata;

export type { DropboxFileMetadata, DropboxEntry };

const UPLOAD_SESSION_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB

const isTransient = (status: number) =>
  status === 429 || (status >= 500 && status <= 599);

const retrySchedule = Schedule.intersect(
  Schedule.exponential(Duration.seconds(1)),
  Schedule.recurs(5)
);

const fetchWithRetry = Effect.fn("dropboxFetch")(function* (
  url: string,
  init: RequestInit,
  endpoint: string
) {
  return yield* Effect.tryPromise({
    try: () => fetch(url, init),
    catch: (e) =>
      new DropboxApiError({
        message: e instanceof Error ? e.message : "Network error",
        endpoint,
      }),
  }).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return Effect.succeed(response);
      if (isTransient(response.status)) {
        const retryAfter = parseInt(
          response.headers.get("Retry-After") ?? "0",
          10
        );
        const fail = Effect.fail(
          new DropboxApiError({
            message: `Transient error: ${response.status}`,
            status: response.status,
            endpoint,
          })
        );
        return retryAfter > 0
          ? Effect.sleep(Duration.seconds(retryAfter)).pipe(
              Effect.zipRight(fail)
            )
          : fail;
      }
      return Effect.tryPromise({
        try: () => response.text(),
        catch: () =>
          new DropboxApiError({
            message: `HTTP ${response.status}`,
            status: response.status,
            endpoint,
          }),
      }).pipe(
        Effect.flatMap((body) =>
          Effect.fail(
            new DropboxApiError({
              message: `HTTP ${response.status}: ${body}`,
              status: response.status,
              endpoint,
            })
          )
        )
      );
    }),
    Effect.retry({
      while: (e) => e._tag === "DropboxApiError" && isTransient(e.status ?? 0),
      schedule: retrySchedule,
    })
  );
});

const authHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

const upload = Effect.fn("dropboxUpload")(function* (opts: {
  accessToken: string;
  path: string;
  content: Buffer;
  mode?: "add" | "overwrite";
}) {
  const response = yield* fetchWithRetry(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        ...authHeaders(opts.accessToken),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: opts.path,
          mode: opts.mode ?? "add",
          autorename: false,
        }),
      },
      body: new Uint8Array(opts.content),
    },
    "upload"
  );
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<DropboxFileMetadata>,
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to parse upload response: ${e}`,
        endpoint: "upload",
      }),
  });
});

const uploadLargeFile = Effect.fn("dropboxUploadLargeFile")(function* (opts: {
  accessToken: string;
  path: string;
  content: Buffer;
  mode?: "add" | "overwrite";
  onProgress?: (uploaded: number, total: number) => void;
}) {
  const { accessToken, path: filePath, content, mode, onProgress } = opts;
  const total = content.length;

  // Start session
  const firstChunkEnd = Math.min(UPLOAD_SESSION_CHUNK_SIZE, total);
  const firstChunk = content.subarray(0, firstChunkEnd);
  const startResponse = yield* fetchWithRetry(
    "https://content.dropboxapi.com/2/files/upload_session/start",
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          close: firstChunkEnd >= total,
        }),
      },
      body: new Uint8Array(firstChunk),
    },
    "upload_session/start"
  );
  const { session_id } = yield* Effect.tryPromise({
    try: () => startResponse.json() as Promise<{ session_id: string }>,
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to parse session start: ${e}`,
        endpoint: "upload_session/start",
      }),
  });

  let offset = firstChunkEnd;
  onProgress?.(offset, total);

  // Append remaining chunks (all but the last)
  while (offset < total - UPLOAD_SESSION_CHUNK_SIZE) {
    const chunkEnd = offset + UPLOAD_SESSION_CHUNK_SIZE;
    const chunk = content.subarray(offset, chunkEnd);
    yield* fetchWithRetry(
      "https://content.dropboxapi.com/2/files/upload_session/append_v2",
      {
        method: "POST",
        headers: {
          ...authHeaders(accessToken),
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            cursor: { session_id, offset },
            close: false,
          }),
        },
        body: new Uint8Array(chunk),
      },
      "upload_session/append_v2"
    );
    offset = chunkEnd;
    onProgress?.(offset, total);
  }

  // Finish session with the last chunk
  const lastChunk =
    offset < total ? content.subarray(offset) : new Uint8Array(0);
  const finishResponse = yield* fetchWithRetry(
    "https://content.dropboxapi.com/2/files/upload_session/finish",
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          cursor: { session_id, offset },
          commit: {
            path: filePath,
            mode: mode ?? "add",
            autorename: false,
          },
        }),
      },
      body: new Uint8Array(lastChunk),
    },
    "upload_session/finish"
  );

  onProgress?.(total, total);

  return yield* Effect.tryPromise({
    try: () => finishResponse.json() as Promise<DropboxFileMetadata>,
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to parse session finish: ${e}`,
        endpoint: "upload_session/finish",
      }),
  });
});

/**
 * Upload a file, choosing simple upload or upload session based on size.
 */
export const uploadFile = Effect.fn("dropboxUploadFile")(function* (opts: {
  accessToken: string;
  path: string;
  content: Buffer;
  mode?: "add" | "overwrite";
  onProgress?: (uploaded: number, total: number) => void;
}) {
  const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;
  if (opts.content.length <= SIMPLE_UPLOAD_LIMIT) {
    opts.onProgress?.(opts.content.length, opts.content.length);
    return yield* upload(opts);
  }
  return yield* uploadLargeFile(opts);
});

const readChunkFromDisk = (fh: FileHandle, position: number, size: number) =>
  Effect.tryPromise({
    try: async () => {
      const buf = Buffer.alloc(size);
      const { bytesRead } = await fh.read(buf, 0, size, position);
      return bytesRead < size ? buf.subarray(0, bytesRead) : buf;
    },
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to read file chunk at offset ${position}: ${e}`,
        endpoint: "upload_session",
      }),
  });

/**
 * Upload a file directly from disk, streaming chunks to avoid loading
 * the entire file into memory. For files under the simple-upload limit
 * this falls back to a single-shot upload; larger files use chunked
 * upload sessions reading 8 MB at a time from the file handle.
 */
export const uploadFileFromDisk = Effect.fn("dropboxUploadFileFromDisk")(
  function* (opts: {
    accessToken: string;
    path: string;
    filePath: string;
    fileSize: number;
    mode?: "add" | "overwrite";
    onProgress?: (uploaded: number, total: number) => void;
  }) {
    const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;
    const {
      accessToken,
      path: remotePath,
      filePath,
      fileSize,
      mode,
      onProgress,
    } = opts;

    if (fileSize <= SIMPLE_UPLOAD_LIMIT) {
      const content = yield* Effect.tryPromise({
        try: () => fsReadFile(filePath),
        catch: (e) =>
          new DropboxApiError({
            message: `Failed to read file for upload: ${e}`,
            endpoint: "upload",
          }),
      });
      onProgress?.(fileSize, fileSize);
      return yield* upload({
        accessToken,
        path: remotePath,
        content: Buffer.from(content),
        mode,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => fsOpen(filePath, "r"),
        catch: (e) =>
          new DropboxApiError({
            message: `Failed to open file for upload: ${e}`,
            endpoint: "upload_session/start",
          }),
      }),
      (fh) =>
        Effect.gen(function* () {
          const total = fileSize;
          const firstChunkEnd = Math.min(UPLOAD_SESSION_CHUNK_SIZE, total);
          const firstChunk = yield* readChunkFromDisk(fh, 0, firstChunkEnd);

          const startResponse = yield* fetchWithRetry(
            "https://content.dropboxapi.com/2/files/upload_session/start",
            {
              method: "POST",
              headers: {
                ...authHeaders(accessToken),
                "Content-Type": "application/octet-stream",
                "Dropbox-API-Arg": JSON.stringify({
                  close: firstChunkEnd >= total,
                }),
              },
              body: new Uint8Array(firstChunk),
            },
            "upload_session/start"
          );
          const { session_id } = yield* Effect.tryPromise({
            try: () => startResponse.json() as Promise<{ session_id: string }>,
            catch: (e) =>
              new DropboxApiError({
                message: `Failed to parse session start: ${e}`,
                endpoint: "upload_session/start",
              }),
          });

          let offset = firstChunkEnd;
          onProgress?.(offset, total);

          while (offset < total - UPLOAD_SESSION_CHUNK_SIZE) {
            const chunk = yield* readChunkFromDisk(
              fh,
              offset,
              UPLOAD_SESSION_CHUNK_SIZE
            );
            yield* fetchWithRetry(
              "https://content.dropboxapi.com/2/files/upload_session/append_v2",
              {
                method: "POST",
                headers: {
                  ...authHeaders(accessToken),
                  "Content-Type": "application/octet-stream",
                  "Dropbox-API-Arg": JSON.stringify({
                    cursor: { session_id, offset },
                    close: false,
                  }),
                },
                body: new Uint8Array(chunk),
              },
              "upload_session/append_v2"
            );
            offset += chunk.length;
            onProgress?.(offset, total);
          }

          const lastChunkSize = total - offset;
          const lastChunk =
            lastChunkSize > 0
              ? yield* readChunkFromDisk(fh, offset, lastChunkSize)
              : Buffer.alloc(0);

          const finishResponse = yield* fetchWithRetry(
            "https://content.dropboxapi.com/2/files/upload_session/finish",
            {
              method: "POST",
              headers: {
                ...authHeaders(accessToken),
                "Content-Type": "application/octet-stream",
                "Dropbox-API-Arg": JSON.stringify({
                  cursor: { session_id, offset },
                  commit: {
                    path: remotePath,
                    mode: mode ?? "add",
                    autorename: false,
                  },
                }),
              },
              body: new Uint8Array(lastChunk),
            },
            "upload_session/finish"
          );

          onProgress?.(total, total);

          return yield* Effect.tryPromise({
            try: () => finishResponse.json() as Promise<DropboxFileMetadata>,
            catch: (e) =>
              new DropboxApiError({
                message: `Failed to parse session finish: ${e}`,
                endpoint: "upload_session/finish",
              }),
          });
        }),
      (fh) => Effect.promise(() => fh.close())
    );
  }
);

/**
 * Download a file's content.
 */
export const download = Effect.fn("dropboxDownload")(function* (opts: {
  accessToken: string;
  path: string;
}) {
  const response = yield* fetchWithRetry(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        ...authHeaders(opts.accessToken),
        "Dropbox-API-Arg": JSON.stringify({ path: opts.path }),
      },
    },
    "download"
  );
  const buffer = yield* Effect.tryPromise({
    try: async () => Buffer.from(await response.arrayBuffer()),
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to read download body: ${e}`,
        endpoint: "download",
      }),
  });
  return buffer;
});

/**
 * Get metadata for a file or folder.
 * Returns null if the path does not exist.
 */
export const getMetadata = Effect.fn("dropboxGetMetadata")(function* (opts: {
  accessToken: string;
  path: string;
}) {
  const response = yield* fetchWithRetry(
    "https://api.dropboxapi.com/2/files/get_metadata",
    {
      method: "POST",
      headers: {
        ...authHeaders(opts.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: opts.path }),
    },
    "get_metadata"
  ).pipe(
    Effect.catchTag("DropboxApiError", (e) =>
      e.status === 409 ? Effect.succeed(null) : Effect.fail(e)
    )
  );

  if (response === null) return null;

  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<DropboxEntry>,
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to parse metadata: ${e}`,
        endpoint: "get_metadata",
      }),
  });
});

/**
 * List all entries in a folder (handles pagination).
 */
export const listFolder = Effect.fn("dropboxListFolder")(function* (opts: {
  accessToken: string;
  path: string;
  recursive?: boolean;
}) {
  const entries: DropboxEntry[] = [];

  const firstResponse = yield* fetchWithRetry(
    "https://api.dropboxapi.com/2/files/list_folder",
    {
      method: "POST",
      headers: {
        ...authHeaders(opts.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: opts.path,
        recursive: opts.recursive ?? false,
      }),
    },
    "list_folder"
  );
  let page = yield* Effect.tryPromise({
    try: () =>
      firstResponse.json() as Promise<{
        entries: DropboxEntry[];
        has_more: boolean;
        cursor: string;
      }>,
    catch: (e) =>
      new DropboxApiError({
        message: `Failed to parse list_folder response: ${e}`,
        endpoint: "list_folder",
      }),
  });
  entries.push(...page.entries);

  while (page.has_more) {
    const contResponse = yield* fetchWithRetry(
      "https://api.dropboxapi.com/2/files/list_folder/continue",
      {
        method: "POST",
        headers: {
          ...authHeaders(opts.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cursor: page.cursor }),
      },
      "list_folder/continue"
    );
    page = yield* Effect.tryPromise({
      try: () =>
        contResponse.json() as Promise<{
          entries: DropboxEntry[];
          has_more: boolean;
          cursor: string;
        }>,
      catch: (e) =>
        new DropboxApiError({
          message: `Failed to parse list_folder/continue response: ${e}`,
          endpoint: "list_folder/continue",
        }),
    });
    entries.push(...page.entries);
  }

  return entries;
});
