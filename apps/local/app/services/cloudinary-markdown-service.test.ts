import { describe, it, expect } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import { Effect, Layer } from "effect";
import { CloudinaryMarkdownService } from "./cloudinary-markdown-service";
import { CloudinaryService } from "./cloudinary-service";
import fs from "node:fs";
import path from "node:path";

// Mock fs.existsSync
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

let testLayer: Layer.Layer<CloudinaryMarkdownService>;
let uploadCounter: number;

const uploadImagesInMarkdown = (body: string, baseDir: string) =>
  Effect.gen(function* () {
    const service = yield* CloudinaryMarkdownService;
    return yield* service.uploadImagesInMarkdown(body, baseDir);
  });

describe("CloudinaryMarkdownService", () => {
  beforeEach(() => {
    uploadCounter = 0;

    // Mock CloudinaryService that returns predictable URLs
    const mockCloudinaryLayer = Layer.succeed(CloudinaryService, {
      upload: (filePath: string) =>
        Effect.gen(function* () {
          uploadCounter++;
          const filename = path.basename(filePath, path.extname(filePath));
          return `https://res.cloudinary.com/test/ai-hero-images/${filename}_${uploadCounter}`;
        }),
    } as any);

    testLayer = CloudinaryMarkdownService.Default.pipe(
      Layer.provide(mockCloudinaryLayer)
    );

    // Default: all files exist
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it.effect("returns unchanged markdown when no images present", () =>
    Effect.gen(function* () {
      const body = "# Hello World\n\nThis is a paragraph with no images.";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toBe(body);
      expect(result.uploadedFilePaths).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("replaces local image reference with Cloudinary URL", () =>
    Effect.gen(function* () {
      const body = "Check this out:\n\n![diagram](diagram.png)\n\nNice!";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toBe(
        "Check this out:\n\n![diagram](https://res.cloudinary.com/test/ai-hero-images/diagram_1)\n\nNice!"
      );
      expect(result.uploadedFilePaths).toEqual([
        path.resolve("/base", "diagram.png"),
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("skips http URLs", () =>
    Effect.gen(function* () {
      const body =
        "![hosted](https://example.com/image.png)\n![also](http://example.com/other.jpg)";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toBe(body);
      expect(result.uploadedFilePaths).toEqual([]);
      expect(uploadCounter).toBe(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("handles mixed local and http images", () =>
    Effect.gen(function* () {
      const body = [
        "![local](screenshot.png)",
        "![remote](https://cdn.example.com/photo.jpg)",
        "![another-local](images/chart.png)",
      ].join("\n");
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toBe(
        [
          "![local](https://res.cloudinary.com/test/ai-hero-images/screenshot_1)",
          "![remote](https://cdn.example.com/photo.jpg)",
          "![another-local](https://res.cloudinary.com/test/ai-hero-images/chart_2)",
        ].join("\n")
      );
      expect(result.uploadedFilePaths).toEqual([
        path.resolve("/base", "screenshot.png"),
        path.resolve("/base", "images/chart.png"),
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("preserves alt text", () =>
    Effect.gen(function* () {
      const body = "![A detailed diagram of the architecture](arch.png)";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toContain(
        "![A detailed diagram of the architecture](https://res.cloudinary.com/test/ai-hero-images/arch_1)"
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("handles empty alt text", () =>
    Effect.gen(function* () {
      const body = "![](image.png)";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toBe(
        "![](https://res.cloudinary.com/test/ai-hero-images/image_1)"
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("processes multiple images", () =>
    Effect.gen(function* () {
      const body =
        "![first](a.png)\n\nSome text\n\n![second](b.png)\n\n![third](c.png)";
      const result = yield* uploadImagesInMarkdown(body, "/base");
      expect(result.body).toContain(
        "![first](https://res.cloudinary.com/test/ai-hero-images/a_1)"
      );
      expect(result.body).toContain(
        "![second](https://res.cloudinary.com/test/ai-hero-images/b_2)"
      );
      expect(result.body).toContain(
        "![third](https://res.cloudinary.com/test/ai-hero-images/c_3)"
      );
      expect(uploadCounter).toBe(3);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("resolves relative paths from base directory", () =>
    Effect.gen(function* () {
      const body = "![img](images/screenshot.png)";
      yield* uploadImagesInMarkdown(body, "/project/lessons/intro");

      // Verify existsSync was called with the resolved path
      expect(fs.existsSync).toHaveBeenCalledWith(
        path.resolve("/project/lessons/intro", "images/screenshot.png")
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when image file does not exist", () =>
    Effect.gen(function* () {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const body = "![missing](nonexistent.png)";
      const result = yield* Effect.either(
        uploadImagesInMarkdown(body, "/base")
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as any).message).toContain("Image file not found");
      }
    }).pipe(Effect.provide(testLayer))
  );
});
