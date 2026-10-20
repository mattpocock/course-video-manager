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
  it("rejects an upload concurrency below 1", async () => {
    await expect(
      readWith(uploadConcurrency, { DROPBOX_UPLOAD_CONCURRENCY: "0" })
    ).rejects.toBeDefined();
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

  it("rejects a chunk size that is not a multiple of 4 MB", async () => {
    await expect(
      readWith(uploadChunkSizeBytes, { DROPBOX_UPLOAD_CHUNK_SIZE_MB: "30" })
    ).rejects.toBeDefined();
  });

  it("rejects a chunk size over Dropbox's 150 MB request limit", async () => {
    await expect(
      readWith(uploadChunkSizeBytes, { DROPBOX_UPLOAD_CHUNK_SIZE_MB: "152" })
    ).rejects.toBeDefined();
    await expect(
      readWith(uploadChunkSizeBytes, { DROPBOX_UPLOAD_CHUNK_SIZE_MB: "148" })
    ).resolves.toBe(148 * 1024 * 1024);
  });
});
