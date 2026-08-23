import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer } from "effect";
import {
  OverlayContentRenderError,
  OverlayContentRendererService,
} from "@/services/overlay-content-renderer";
import {
  overlayContentHashAtVersion,
  overlayRenderFilename,
  computeOverlayContentHash,
  OVERLAY_RENDERER_VERSION,
  type DefinitionCardContent,
  type OverlayContent,
} from "@/services/overlay-render-cache";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";

const cacheDirs: string[] = [];

const makeCacheDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cvm-overlay-cache-"));
  cacheDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    cacheDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

const card = (
  overrides: Partial<DefinitionCardContent> = {}
): DefinitionCardContent => ({
  kind: "definitionCard",
  title: "Hydration",
  description: "Attaching React to server-rendered HTML.",
  durationInSeconds: 4,
  ...overrides,
});

/**
 * The renderer, faked at the process boundary — the only place a fake is
 * allowed here. A real render boots Chromium; this one writes the bytes a
 * render would have written, and remembers that it was asked.
 */
const fakeRenderer = () => {
  const renders: { content: OverlayContent; outputPath: string }[] = [];
  const layer = Layer.succeed(OverlayContentRendererService, {
    renderOverlayContent: (content: OverlayContent, outputPath: string) =>
      Effect.promise(async () => {
        renders.push({ content, outputPath });
        await fs.writeFile(outputPath, `rendered:${content.title}`);
      }),
  } as unknown as OverlayContentRendererService);
  return { renders, layer };
};

const renderCard = (
  cacheDir: string,
  rendererLayer: Layer.Layer<OverlayContentRendererService>,
  opts: { courseId: string; content: OverlayContent }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* OverlayRenderCacheService;
      return yield* cache.renderOverlay(opts);
    }).pipe(
      Effect.provide(
        OverlayRenderCacheService.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.mergeAll(NodeContext.layer, rendererLayer))
        )
      ),
      Effect.provide(
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([["OVERLAY_RENDER_CACHE_DIRECTORY", cacheDir]])
          )
        )
      )
    )
  );

describe("OverlayRenderCacheService", () => {
  it("renders a Definition Card into the cache directory and says where", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const renderedPath = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });

    expect(renderedPath).toBe(
      path.join(
        cacheDir,
        overlayRenderFilename("course-1", computeOverlayContentHash(card()))
      )
    );
    expect(existsSync(renderedPath)).toBe(true);
    expect(renderer.renders).toHaveLength(1);
  });

  it("creates the cache directory if it does not exist yet", async () => {
    const cacheDir = path.join(await makeCacheDir(), "not", "created", "yet");
    const renderer = fakeRenderer();

    const renderedPath = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });

    expect(existsSync(renderedPath)).toBe(true);
  });

  it("reuses the cached render for the same content instead of rendering again", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const first = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });
    const second = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });

    expect(second).toBe(first);
    expect(renderer.renders).toHaveLength(1);
  });

  it("shares one cache entry between two Definition Cards with the same content", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const onePlacement = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });
    const anotherPlacement = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: {
        kind: card().kind,
        title: card().title,
        description: card().description,
        durationInSeconds: card().durationInSeconds,
      },
    });

    expect(anotherPlacement).toBe(onePlacement);
    expect(renderer.renders).toHaveLength(1);
  });

  it("re-renders when the card's content changes", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const first = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });
    const second = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card({ description: "Something else entirely." }),
    });

    expect(second).not.toBe(first);
    expect(renderer.renders).toHaveLength(2);
  });

  it("gives the same content under a different course its own file", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const forOneCourse = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });
    const forAnother = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-2",
      content: card(),
    });

    expect(path.basename(forOneCourse)).not.toBe(path.basename(forAnother));
    expect(renderer.renders).toHaveLength(2);
    // Same content, so the two files differ only by their course prefix.
    expect(path.basename(forOneCourse).replace("course-1-", "")).toBe(
      path.basename(forAnother).replace("course-2-", "")
    );
  });

  it("ignores a render cached under an older Overlay Renderer Version", async () => {
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    const stalePath = path.join(
      cacheDir,
      overlayRenderFilename(
        "course-1",
        overlayContentHashAtVersion(card(), OVERLAY_RENDERER_VERSION - 1)
      )
    );
    await fs.writeFile(stalePath, "rendered by an older renderer");

    const renderedPath = await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });

    expect(renderedPath).not.toBe(stalePath);
    expect(renderer.renders).toHaveLength(1);
  });

  it("renders to a scratch name that keeps the `.mov` extension", async () => {
    // Remotion reads the output extension to pick the container, and refuses a
    // ProRes render to a name ending in anything but `mov`, `mkv` or `mxf`. A
    // scratch name that drops the extension fails every render on the machine
    // and none in the suite, so the extension is asserted here.
    const cacheDir = await makeCacheDir();
    const renderer = fakeRenderer();

    await renderCard(cacheDir, renderer.layer, {
      courseId: "course-1",
      content: card(),
    });

    expect(renderer.renders).toHaveLength(1);
    const scratchPath = renderer.renders[0]!.outputPath;
    expect(path.extname(scratchPath)).toBe(".mov");
    // Still a scratch name, not the address itself.
    expect(scratchPath).not.toBe(
      path.join(
        cacheDir,
        overlayRenderFilename("course-1", computeOverlayContentHash(card()))
      )
    );
  });

  it("leaves nothing behind at the cached address when a render fails", async () => {
    const cacheDir = await makeCacheDir();
    // A renderer that dies halfway: some bytes on disk, no finished render.
    const failing = Layer.succeed(OverlayContentRendererService, {
      renderOverlayContent: (_content: OverlayContent, outputPath: string) =>
        Effect.promise(() => fs.writeFile(outputPath, "half a mov")).pipe(
          Effect.andThen(
            Effect.fail(
              new OverlayContentRenderError({
                cause: null,
                message: "the overlay renderer exited with code 1",
              })
            )
          )
        ),
    } as unknown as OverlayContentRendererService);

    await expect(
      renderCard(cacheDir, failing, { courseId: "course-1", content: card() })
    ).rejects.toThrow();

    expect(await fs.readdir(cacheDir)).toEqual([]);
  });
});
