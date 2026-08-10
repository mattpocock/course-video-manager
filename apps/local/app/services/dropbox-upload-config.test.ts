import { describe, it, expect } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import {
  uploadChunkSizeBytes,
  uploadConcurrency,
} from "@/services/dropbox-upload-config";

const readWith = <A>(
  config: Effect.Effect<A, any>,
  entries: Record<string, string> = {}
) =>
  Effect.runPromise(
    config.pipe(
      Effect.provide(
        Layer.setConfigProvider(
          ConfigProvider.fromMap(new Map(Object.entries(entries)))
        )
      )
    )
  );

describe("Dropbox upload configuration", () => {
  it("defaults upload concurrency to 4", async () => {
    await expect(readWith(uploadConcurrency)).resolves.toBe(4);
  });

  it("reads upload concurrency from DROPBOX_UPLOAD_CONCURRENCY", async () => {
    await expect(
      readWith(uploadConcurrency, { DROPBOX_UPLOAD_CONCURRENCY: "8" })
    ).resolves.toBe(8);
  });

  it("rejects an upload concurrency below 1", async () => {
    await expect(
      readWith(uploadConcurrency, { DROPBOX_UPLOAD_CONCURRENCY: "0" })
    ).rejects.toBeDefined();
  });

  it("defaults the upload chunk size to 16 MB", async () => {
    await expect(readWith(uploadChunkSizeBytes)).resolves.toBe(
      16 * 1024 * 1024
    );
  });

  it("reads the upload chunk size from DROPBOX_UPLOAD_CHUNK_SIZE_MB", async () => {
    await expect(
      readWith(uploadChunkSizeBytes, { DROPBOX_UPLOAD_CHUNK_SIZE_MB: "32" })
    ).resolves.toBe(32 * 1024 * 1024);
  });

  it("rejects a chunk size below Dropbox's 4 MB granularity", async () => {
    await expect(
      readWith(uploadChunkSizeBytes, { DROPBOX_UPLOAD_CHUNK_SIZE_MB: "1" })
    ).rejects.toBeDefined();
  });
});
