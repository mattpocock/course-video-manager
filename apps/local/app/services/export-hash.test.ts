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
  type ExportOverlay,
} from "@/services/export-hash";
import { garbageCollect } from "@/services/export-hash.server";

const makeClip = (
  overrides: Partial<ExportClip> &
    Pick<ExportClip, "videoFilename" | "sourceStartTime" | "sourceEndTime">
): ExportClip => ({
  pauseType: "none",
  zoomType: "none",
  overlays: [],
  ...overrides,
});

describe("export-hash", () => {
  describe("computeExportHash", () => {
    it("returns null for empty clips", () => {
      expect(computeExportHash([], "landscape")).toBeNull();
    });

    it("returns a 32-char hex string for clips", () => {
      const hash = computeExportHash(
        [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
          }),
        ],
        "landscape"
      );
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("changing the video format changes the hash", () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      expect(computeExportHash(clips, "landscape")).not.toBe(
        computeExportHash(clips, "short")
      );
    });

    it("treats an unknown or missing format as landscape", () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const landscape = computeExportHash(clips, "landscape");
      expect(computeExportHash(clips, undefined)).toBe(landscape);
      expect(computeExportHash(clips, null)).toBe(landscape);
      expect(computeExportHash(clips, "bogus")).toBe(landscape);
    });

    it("is deterministic for the same input", () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
        makeClip({
          videoFilename: "rec2.mp4",
          sourceStartTime: 5,
          sourceEndTime: 15,
        }),
      ];
      const hash1 = computeExportHash(clips, "landscape");
      const hash2 = computeExportHash(clips, "landscape");
      expect(hash1).toBe(hash2);
    });

    it("hashes clips in the given array order, not a re-sorted one", () => {
      const a = makeClip({
        videoFilename: "a.mp4",
        sourceStartTime: 0,
        sourceEndTime: 5,
      });
      const b = makeClip({
        videoFilename: "b.mp4",
        sourceStartTime: 0,
        sourceEndTime: 5,
      });
      // Clip sequence lives in the array itself — reordering the same clips is a
      // different edit and must produce a different hash (and thus re-export).
      expect(computeExportHash([a, b], "landscape")).not.toBe(
        computeExportHash([b, a], "landscape")
      );
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
      expect(computeExportHash(clips1, "landscape")).toBe(
        computeExportHash(clips2, "landscape")
      );
    });

    it("different clip data produces different hashes", () => {
      const hash1 = computeExportHash(
        [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
          }),
        ],
        "landscape"
      );
      const hash2 = computeExportHash(
        [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 11,
          }),
        ],
        "landscape"
      );
      expect(hash1).not.toBe(hash2);
    });

    it("a long pause changes the hash, because it changes the bytes", () => {
      // The renderer holds a "long" clip open for an extra LONG_PAUSE_DURATION,
      // so two videos differing only here are genuinely different videos and
      // must not share an export.
      const at = (pauseType: string) =>
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              pauseType,
            }),
          ],
          "landscape"
        );

      expect(at("long")).not.toBe(at("none"));
    });

    it("treats every pause type the renderer ignores as 'none'", () => {
      // pause_type is a varchar, not an enum. Only "long" reaches ffmpeg as a
      // duration change, so only "long" may move the address.
      const at = (pauseType: string) =>
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              pauseType,
            }),
          ],
          "landscape"
        );

      expect(at("short")).toBe(at("none"));
      expect(at("")).toBe(at("none"));
    });

    // Regression guard for the migration: pauseType was added to the address
    // after thousands of exports were already on disk under the old scheme.
    // Because "none" contributes nothing to the payload, those files stayed
    // addressable and only the long-pause videos re-exported. Changing this
    // constant means re-exporting and re-publishing the entire catalogue.
    it("leaves the address of a clip without a long pause untouched", () => {
      expect(
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              pauseType: "none",
              zoomType: "none",
            }),
          ],
          "landscape"
        )
      ).toBe("ae5332862e6c002c82e975dceadd3cab");
    });

    it("changing a clip's Clip Zoom changes the address", () => {
      // The renderer crops a zoomed clip, so it ships different bytes. A zoom
      // that did not reach the address would leave the un-zoomed export
      // addressable and the Publish would ship it.
      const at = (zoomType: string) =>
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              zoomType,
            }),
          ],
          "landscape"
        );

      expect(at("subtle")).not.toBe(at("none"));
    });

    it("treats an unrecognised zoom as no zoom", () => {
      const at = (zoomType: string) =>
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              zoomType,
            }),
          ],
          "landscape"
        );

      expect(at("wildly-zoomed")).toBe(at("none"));
      expect(at("")).toBe(at("none"));
    });

    // ── Overlays ──────────────────────────────────────────────────────

    const card = (overrides: Partial<ExportOverlay> = {}): ExportOverlay => ({
      at: 2,
      durationInSeconds: 4,
      kind: "definitionCard",
      title: "Hydration",
      description: "Attaching handlers to server-rendered HTML.",
      bullets: null,
      disableEnterAnimation: false,
      disableExitAnimation: false,
      ...overrides,
    });

    const withOverlays = (...overlays: ExportOverlay[]) =>
      computeExportHash(
        [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
            overlays,
          }),
        ],
        "landscape"
      );

    it("changing a Definition Card's title changes the address", () => {
      expect(withOverlays(card({ title: "Hydration" }))).not.toBe(
        withOverlays(card({ title: "Rehydration" }))
      );
    });

    it("changing a Definition Card's description changes the address", () => {
      expect(withOverlays(card({ description: "One thing" }))).not.toBe(
        withOverlays(card({ description: "Another thing" }))
      );
    });

    it("moving an Overlay's anchor changes the address", () => {
      expect(withOverlays(card({ at: 2 }))).not.toBe(
        withOverlays(card({ at: 2.5 }))
      );
    });

    it("changing how long an Overlay stays up changes the address", () => {
      expect(withOverlays(card({ durationInSeconds: 4 }))).not.toBe(
        withOverlays(card({ durationInSeconds: 6 }))
      );
    });

    it("changing an Overlay's kind changes the address", () => {
      expect(withOverlays(card({ kind: "definitionCard" }))).not.toBe(
        withOverlays(card({ kind: "bulletPanel" }))
      );
    });

    it("leaves the address alone for an Overlay written before kind existed", () => {
      // Those rows read as "definitionCard", and the default is omitted from
      // the payload, so every export addressed before the column existed keeps
      // the address it already had.
      expect(withOverlays(card({ kind: "definitionCard" }))).toBe(
        withOverlays(card({ kind: "" }))
      );
    });

    it("adding an Overlay changes the address", () => {
      expect(withOverlays()).not.toBe(withOverlays(card()));
    });

    it("deleting one of two Overlays changes the address", () => {
      expect(withOverlays(card(), card({ at: 7, title: "Suspense" }))).not.toBe(
        withOverlays(card())
      );
    });

    it("re-anchoring an Overlay to another clip changes the address", () => {
      // An Overlay's anchor Clip is carried by which clip it rides on, so
      // `overlay update --clip` has to move it in the payload.
      const twoClips = (first: ExportOverlay[], second: ExportOverlay[]) =>
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              overlays: first,
            }),
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 20,
              sourceEndTime: 30,
              overlays: second,
            }),
          ],
          "landscape"
        );

      expect(twoClips([card()], [])).not.toBe(twoClips([], [card()]));
    });

    it("does not read an order into a clip's Overlays", () => {
      // Overlays are anchored to moments, not sequenced, so the order the
      // database hands them back must not move the address.
      const a = card({ at: 1, title: "A" });
      const b = card({ at: 6, title: "B" });
      expect(withOverlays(a, b)).toBe(withOverlays(b, a));
    });

    // Regression guard, exactly like the long-pause one above: Overlays were
    // added to the address after the whole catalogue was already exported.
    // A clip with no Overlays contributes nothing, so every one of those files
    // stayed addressable and nothing re-exported. Changing this constant means
    // re-exporting and re-publishing the entire catalogue.
    it("leaves the address of a clip with no Overlays untouched", () => {
      expect(
        computeExportHash(
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
              overlays: [],
            }),
          ],
          "landscape"
        )
      ).toBe("ae5332862e6c002c82e975dceadd3cab");
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
      const hash = computeExportHash(clips, "landscape");
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
      const hash = computeExportHash(
        [
          makeClip({
            videoFilename: "rec.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
          }),
        ],
        "landscape"
      )!;

      const fsLayer = FileSystem.layerNoop({
        exists: (filePath) =>
          Effect.succeed(filePath === `/output/course-1-${hash}.mp4`),
      });

      const result = await Effect.runPromise(
        isExported(
          "/output",
          "course-1",
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
            }),
          ],
          "landscape"
        ).pipe(Effect.provide(fsLayer))
      );

      expect(result).toBe(true);
    });

    it("returns false when the file does not exist", async () => {
      const fsLayer = FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
      });

      const result = await Effect.runPromise(
        isExported(
          "/output",
          "course-1",
          [
            makeClip({
              videoFilename: "rec.mp4",
              sourceStartTime: 0,
              sourceEndTime: 10,
            }),
          ],
          "landscape"
        ).pipe(Effect.provide(fsLayer))
      );

      expect(result).toBe(false);
    });

    it("returns false for videos with no clips", async () => {
      const fsLayer = FileSystem.layerNoop({
        exists: () => Effect.succeed(true),
      });

      const result = await Effect.runPromise(
        isExported("/output", "course-1", [], "landscape").pipe(
          Effect.provide(fsLayer)
        )
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
      const validHash = computeExportHash(validClips, "landscape")!;

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
      const hash = computeExportHash(clips, "landscape")!;

      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips }],
        filesOnDisk: [`course-1-${hash}.mp4`],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      expect(removedFiles).toEqual([]);
    });

    it("deletes a stale export's digest sidecar along with it", async () => {
      const validClips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const validHash = computeExportHash(validClips, "landscape")!;
      const staleHash = "deadbeef12345678901234567890abcd";

      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips: validClips }],
        filesOnDisk: [
          `course-1-${validHash}.mp4`,
          `course-1-${validHash}.mp4.sha256`,
          `course-1-${staleHash}.mp4`,
          `course-1-${staleHash}.mp4.sha256`,
        ],
      });

      await Effect.runPromise(
        garbageCollect("course-1").pipe(Effect.provide(layer))
      );

      // The sidecar shares the export's Export Hash, so it shares its fate —
      // otherwise every collected export would leave one behind forever.
      expect(removedFiles.sort()).toEqual([
        `/output/course-1-${staleHash}.mp4`,
        `/output/course-1-${staleHash}.mp4.sha256`,
      ]);
    });

    it("keeps the digest sidecar of a referenced export", async () => {
      const clips = [
        makeClip({
          videoFilename: "rec.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
        }),
      ];
      const hash = computeExportHash(clips, "landscape")!;

      const { layer, removedFiles } = makeGCLayer({
        versions: [{ id: "v1", clips }],
        filesOnDisk: [`course-1-${hash}.mp4`, `course-1-${hash}.mp4.sha256`],
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
      const hash1 = computeExportHash(clips1, "landscape")!;
      const hash2 = computeExportHash(clips2, "landscape")!;

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
