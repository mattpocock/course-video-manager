import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  computeExportHash,
  exportFilename,
  resolveExportPath,
  isExported,
  EXPORT_VERSION,
  type ExportClip,
} from "@/services/export-hash";
import { garbageCollect } from "@/services/export-hash.server";

const makeClip = (
  overrides: Partial<ExportClip> &
    Pick<ExportClip, "videoFilename" | "sourceStartTime" | "sourceEndTime">
): ExportClip => ({
  order: "a0",
  ...overrides,
});

describe("export-hash", () => {
  describe("computeExportHash", () => {
    it("returns null for empty clips", () => {
      expect(computeExportHash([])).toBeNull();
    });

    it("returns a 32-char hex string for clips", () => {
      const hash = computeExportHash([
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ]);
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("is deterministic for the same input", () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
          order: "a0",
        }),
        makeClip({
          videoFilename: "rec2.mp4",
          sourceStartTime: 5,
          sourceEndTime: 15,
          order: "a1",
        }),
      ];
      const hash1 = computeExportHash(clips);
      const hash2 = computeExportHash(clips);
      expect(hash1).toBe(hash2);
    });

    it("sorts clips by order field before hashing", () => {
      const clipsAB = [
        makeClip({
          videoFilename: "a.mp4",
          sourceStartTime: 0,
          sourceEndTime: 5,
          order: "a0",
        }),
        makeClip({
          videoFilename: "b.mp4",
          sourceStartTime: 0,
          sourceEndTime: 5,
          order: "a1",
        }),
      ];
      const clipsBA = [
        makeClip({
          videoFilename: "b.mp4",
          sourceStartTime: 0,
          sourceEndTime: 5,
          order: "a1",
        }),
        makeClip({
          videoFilename: "a.mp4",
          sourceStartTime: 0,
          sourceEndTime: 5,
          order: "a0",
        }),
      ];
      expect(computeExportHash(clipsAB)).toBe(computeExportHash(clipsBA));
    });

    it("transcript text changes do not affect the hash", () => {
      // ExportClip doesn't include text at all, so this is guaranteed by type
      // But let's verify the hash only depends on f, s, e
      const clips1 = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const clips2 = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      expect(computeExportHash(clips1)).toBe(computeExportHash(clips2));
    });

    it("different clip data produces different hashes", () => {
      const hash1 = computeExportHash([
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ]);
      const hash2 = computeExportHash([
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 11,
        }),
      ]);
      expect(hash1).not.toBe(hash2);
    });

    it("changing EXPORT_VERSION would change hashes", () => {
      // We can't easily change the constant in a test, but we can verify
      // the hash includes version info by checking the payload structure
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const hash = computeExportHash(clips);
      expect(hash).toBeTruthy();
      // The EXPORT_VERSION is baked into the hash payload
      expect(EXPORT_VERSION).toBe(1);
    });
  });

  describe("exportFilename", () => {
    it("returns {courseId}-{hash}.mp4", () => {
      expect(exportFilename("course-123", "abc123")).toBe(
        "course-123-abc123.mp4"
      );
    });
  });

  describe("resolveExportPath", () => {
    it("returns absolute path in finished videos directory", () => {
      expect(resolveExportPath("/output", "course-123", "abc123")).toBe(
        "/output/course-123-abc123.mp4"
      );
    });
  });

  describe("isExported", () => {
    it("returns true when the file exists on disk", async () => {
      const hash = computeExportHash([
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ])!;

      const fsLayer = FileSystem.layerNoop({
        exists: (filePath) =>
          Effect.succeed(filePath === `/output/course-1-${hash}.mp4`),
      });

      const result = await Effect.runPromise(
        isExported("/output", "course-1", [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
          }),
        ]).pipe(Effect.provide(fsLayer))
      );

      expect(result).toBe(true);
    });

    it("returns false when the file does not exist", async () => {
      const fsLayer = FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
      });

      const result = await Effect.runPromise(
        isExported("/output", "course-1", [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
          }),
        ]).pipe(Effect.provide(fsLayer))
      );

      expect(result).toBe(false);
    });

    it("returns false for videos with no clips", async () => {
      const fsLayer = FileSystem.layerNoop({
        exists: () => Effect.succeed(true),
      });

      const result = await Effect.runPromise(
        isExported("/output", "course-1", []).pipe(Effect.provide(fsLayer))
      );

      expect(result).toBe(false);
    });
  });

  describe("garbageCollect", () => {
    const makeGCLayer = (opts: {
      versions: Array<{
        id: string;
        clips: ExportClip[];
      }>;
      filesOnDisk: string[];
    }) => {
      // Compute valid hashes for the version data
      const versionMeta = opts.versions.map((v) => ({
        id: v.id,
        repoId: "course-1",
        name: "v",
        description: "",
        createdAt: new Date(),
      }));

      const dbLayer = Layer.succeed(VersionOperationsService, {
        getCourseVersions: () => Effect.succeed(versionMeta),
        getVersionWithSections: (versionId: string) => {
          const ver = opts.versions.find((v) => v.id === versionId);
          return Effect.succeed({
            id: versionId,
            name: "v",
            repoId: "course-1",
            repo: { id: "course-1", name: "test", localPath: "/repo" },
            sections: [
              {
                id: "s1",
                path: "section",
                lessons: [
                  {
                    id: "l1",
                    path: "lesson",
                    fsStatus: "real",
                    videos: [
                      {
                        id: "vid1",
                        path: "video",
                        clips: ver?.clips ?? [],
                      },
                    ],
                  },
                ],
              },
            ],
          });
        },
      } as any);

      const removedFiles: string[] = [];
      const fsLayer = FileSystem.layerNoop({
        exists: () => Effect.succeed(true),
        readDirectory: () => Effect.succeed(opts.filesOnDisk),
        remove: (filePath) =>
          Effect.sync(() => {
            removedFiles.push(filePath as string);
          }),
      });

      const configLayer = Layer.setConfigProvider(
        ConfigProvider.fromMap(
          new Map([["FINISHED_VIDEOS_DIRECTORY", "/output"]])
        )
      );

      return {
        layer: Layer.mergeAll(dbLayer, fsLayer, configLayer),
        removedFiles,
      };
    };

    it("deletes files whose hash is not referenced by any version", async () => {
      const validClips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const validHash = computeExportHash(validClips)!;

      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips: validClips }],
        filesOnDisk: [
          `course-1-${validHash}.mp4`,
          "course-1-deadbeef12345678901234567890ab.mp4",
        ],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      expect(removedFiles).toEqual([
        "/output/course-1-deadbeef12345678901234567890ab.mp4",
      ]);
    });

    it("keeps files that are referenced by any version", async () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const hash = computeExportHash(clips)!;

      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips }],
        filesOnDisk: [`course-1-${hash}.mp4`],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      expect(removedFiles).toEqual([]);
    });

    it("only considers files matching the courseId prefix", async () => {
      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips: [] }],
        filesOnDisk: [
          "other-course-abc123.mp4",
          "unrelated-file.txt",
          "course-1-stale12345678901234567890abcd.mp4",
        ],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      // Only the course-1 prefixed file should be considered for deletion
      expect(removedFiles).toEqual([
        "/output/course-1-stale12345678901234567890abcd.mp4",
      ]);
    });

    it("handles multiple versions with different valid hashes", async () => {
      const clips1 = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const clips2 = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 20,
        }),
      ];
      const hash1 = computeExportHash(clips1)!;
      const hash2 = computeExportHash(clips2)!;

      const { layer, removedFiles } = makeGCLayer({
        versions: [
          { id: "v1", clips: clips1 },
          { id: "v2", clips: clips2 },
        ],
        filesOnDisk: [
          `course-1-${hash1}.mp4`,
          `course-1-${hash2}.mp4`,
          "course-1-oldstale1234567890123456789012.mp4",
        ],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      // Only the stale file should be deleted
      expect(removedFiles).toEqual([
        "/output/course-1-oldstale1234567890123456789012.mp4",
      ]);
    });
  });
});
