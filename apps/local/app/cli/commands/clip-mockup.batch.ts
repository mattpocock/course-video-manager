import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { newFrameFilename } from "@/services/clip-mockup-files";
import { captureFramesInDaemon } from "@/services/clip-mockup-daemon/client";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  FrameCaptureError,
  FrameCaptureService,
  type CaptureViewport,
} from "@/services/frame-capture-service";
import {
  SHORT_FRAME,
  shortFramePageHtml,
  type ShortScene,
} from "@/services/short-clip-mockup-frame";
import { parseError } from "@/cli/helpers";

/**
 * THE `--clip-mockups-json` FILE: the only way `cvm clip-mockup add` and
 * `update` take their input.
 *
 * Batch-only on purpose. Capturing a frame is the slow part a command waits
 * for, and is cheapest done many at a time in the Clip Mockup daemon — as is
 * voicing the lines, which a whole file queues as ONE `clip-mockup-voice` Job
 * (`clip-mockup.voice.ts`). A Video's worth of moments in one file is also the
 * only way to say what ORDER they go in, because the file order is the
 * Animatic order. A file with one entry is still a file.
 *
 * Everything in the file is checked before any work starts — a frame is not
 * captured and a voice is not queued for a file with a typo in entry 40.
 */

const ENTITY = "clipMockup";

/** A frame source, resolved to an absolute path. */
export type FrameSource =
  | { readonly kind: "html"; readonly path: string }
  | { readonly kind: "image"; readonly path: string };

/**
 * What a frame is made from, once the Video's format is known.
 *
 * - `landscape`: the agent's page or PNG IS the 1920x1080 frame.
 * - `short`: CVM composes a whole 1080x1920 frame around it from the Short
 *   layout (`short-clip-mockup-frame.ts`) — the Camera scene from nothing,
 *   the Code scene around the agent's page or PNG.
 */
export type FrameSpec =
  | { readonly format: "landscape"; readonly source: FrameSource }
  | { readonly format: "short"; readonly scene: "camera" }
  | {
      readonly format: "short";
      readonly scene: "code";
      readonly source: FrameSource;
    };

/** The Landscape frame's size. */
const LANDSCAPE_FRAME: CaptureViewport = {
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
};

/**
 * One `add` entry: a moment, or a Clip Mockup Chapter dividing moments.
 *
 * `scene` is a Short's only, and is checked against the Video once it is
 * read (`clip-mockup.short.ts`). `frame` is missing only on a Camera moment,
 * which CVM draws.
 */
export type AddEntry =
  | {
      readonly type: "clipMockup";
      readonly line: string;
      readonly scene: ShortScene | undefined;
      readonly frame: FrameSource | undefined;
    }
  | { readonly type: "clipMockupChapter"; readonly name: string };

/** How an `update` entry names its Clip Mockup. */
export type UpdateTarget =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "position"; readonly video: string; readonly at: number };

/** One `update` entry. Anything left out is left as it is. */
export interface UpdateEntry {
  readonly target: UpdateTarget;
  readonly line: string | undefined;
  readonly frame: FrameSource | undefined;
}

const ADD_KEYS = new Set(["say", "html", "image", "scene", "chapter"]);
const SCENES: ReadonlyArray<ShortScene> = ["camera", "code"];
const UPDATE_KEYS = new Set(["id", "video", "at", "say", "html", "image"]);

/** Read the file (or STDIN for "-") and the directory its paths are relative to. */
const readEntries = (source: string) =>
  Effect.gen(function* () {
    const shown = source === "-" ? "(stdin)" : `"${source}"`;
    const text = yield* Effect.try({
      try: () => readFileSync(source === "-" ? 0 : source, "utf8"),
      catch: () =>
        parseError(`could not read --clip-mockups-json ${shown}`, ENTITY),
    });
    const raw = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () =>
        parseError(`--clip-mockups-json ${shown} is not valid JSON`, ENTITY),
    });
    if (!Array.isArray(raw) || raw.length === 0) {
      return yield* parseError(
        `--clip-mockups-json ${shown} must be a JSON array with at least one entry`,
        ENTITY
      );
    }
    // Paths in the file are relative to the FILE, so a file and the frames
    // beside it can be moved or named from anywhere. STDIN has no directory,
    // so its paths are relative to where `cvm` was run.
    const baseDir =
      source === "-"
        ? process.cwd()
        : nodePath.dirname(nodePath.resolve(source));
    return { entries: raw as unknown[], baseDir };
  });

/** Check one entry is an object with only known keys, each of the right type. */
const readObject = (entry: unknown, n: number, allowed: ReadonlySet<string>) =>
  Effect.gen(function* () {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return yield* parseError(`entry ${n} is not a JSON object`, ENTITY);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        return yield* parseError(
          `entry ${n} has an unknown key "${key}" (allowed: ${[...allowed].join(", ")})`,
          ENTITY
        );
      }
    }
    const text = (key: string) =>
      Effect.gen(function* () {
        const value = record[key];
        if (value === undefined) return undefined;
        if (typeof value !== "string") {
          return yield* parseError(
            `entry ${n}: "${key}" must be a string`,
            ENTITY
          );
        }
        return value;
      });
    return { record, text };
  });

/** A line is mandatory where it is given: an empty one is a mistake, not a pause. */
const requireLine = (line: string, n: number) =>
  line.trim() === ""
    ? parseError(
        `entry ${n}: "say" must not be empty (a Clip Mockup must have a line)`,
        ENTITY
      )
    : Effect.succeed(line);

/**
 * The frame source of one entry — the ONE place the "at most one of html and
 * image" rule lives. `undefined` when the entry names neither.
 */
const readFrame = (
  html: string | undefined,
  image: string | undefined,
  n: number,
  baseDir: string
) =>
  Effect.gen(function* () {
    if (html !== undefined && image !== undefined) {
      return yield* parseError(
        `entry ${n} has both "html" and "image"; a Clip Mockup has one picture`,
        ENTITY
      );
    }
    if (html !== undefined) {
      return { kind: "html", path: nodePath.resolve(baseDir, html) } as const;
    }
    if (image !== undefined) {
      return { kind: "image", path: nodePath.resolve(baseDir, image) } as const;
    }
    return undefined;
  });

/**
 * Every frame source in the batch must exist NOW. A path typed wrong is
 * invalid input (exit 3); only a page that really could not be rendered is a
 * FrameCaptureError.
 */
const requireFramesExist = (frames: ReadonlyArray<FrameSource | undefined>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const [i, frame] of frames.entries()) {
      if (frame === undefined) continue;
      const exists = yield* fs
        .exists(frame.path)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return yield* parseError(
          `entry ${i + 1}: cannot read source ${frame.kind === "html" ? "HTML" : "image"} ${frame.path}`,
          ENTITY
        );
      }
    }
  });

/** Read and check an `add` file. */
export const readAddEntries = (source: string) =>
  Effect.gen(function* () {
    const { entries, baseDir } = yield* readEntries(source);
    const parsed: AddEntry[] = [];
    for (const [i, entry] of entries.entries()) {
      const n = i + 1;
      const { text } = yield* readObject(entry, n, ADD_KEYS);
      const chapter = yield* text("chapter");
      const say = yield* text("say");
      const html = yield* text("html");
      const image = yield* text("image");
      const sceneText = yield* text("scene");

      if (chapter !== undefined) {
        if (
          say !== undefined ||
          html !== undefined ||
          image !== undefined ||
          sceneText !== undefined
        ) {
          return yield* parseError(
            `entry ${n} is a Chapter, so it takes "chapter" alone — no line and no picture`,
            ENTITY
          );
        }
        if (chapter.trim() === "") {
          return yield* parseError(
            `entry ${n}: "chapter" must not be empty`,
            ENTITY
          );
        }
        parsed.push({ type: "clipMockupChapter", name: chapter });
        continue;
      }

      if (say === undefined) {
        return yield* parseError(
          `entry ${n} needs "say" (a Clip Mockup must have a line), or "chapter" for a divider`,
          ENTITY
        );
      }
      if (
        sceneText !== undefined &&
        !SCENES.includes(sceneText as ShortScene)
      ) {
        return yield* parseError(
          `entry ${n}: "scene" must be "camera" or "code" (a Short's two scenes)`,
          ENTITY
        );
      }
      const scene = sceneText as ShortScene | undefined;
      const frame = yield* readFrame(html, image, n, baseDir);
      if (scene === "camera" && frame !== undefined) {
        return yield* parseError(
          `entry ${n} is a Camera moment, which CVM draws: give it "say" and "scene" only, no "html" or "image"`,
          ENTITY
        );
      }
      if (scene !== "camera" && frame === undefined) {
        return yield* parseError(
          `entry ${n} needs one of "html" or "image" (a Clip Mockup must have a picture)`,
          ENTITY
        );
      }
      parsed.push({
        type: "clipMockup",
        line: yield* requireLine(say, n),
        scene,
        frame,
      });
    }
    yield* requireFramesExist(
      parsed.map((e) => (e.type === "clipMockup" ? e.frame : undefined))
    );
    return parsed;
  });

/** Read and check an `update` file. */
export const readUpdateEntries = (source: string) =>
  Effect.gen(function* () {
    const { entries, baseDir } = yield* readEntries(source);
    const parsed: UpdateEntry[] = [];
    for (const [i, entry] of entries.entries()) {
      const n = i + 1;
      const { record, text } = yield* readObject(entry, n, UPDATE_KEYS);
      const id = yield* text("id");
      const video = yield* text("video");
      const say = yield* text("say");
      const at = record.at;
      if (
        at !== undefined &&
        !(typeof at === "number" && Number.isInteger(at))
      ) {
        return yield* parseError(
          `entry ${n}: "at" must be a whole number`,
          ENTITY
        );
      }

      let target: UpdateTarget;
      if (id !== undefined) {
        if (video !== undefined || at !== undefined) {
          return yield* parseError(
            `entry ${n} names its Clip Mockup twice: use "id", or "video" with "at", not both`,
            ENTITY
          );
        }
        target = { kind: "id", id };
      } else if (video !== undefined && at !== undefined) {
        target = { kind: "position", video, at };
      } else {
        return yield* parseError(
          `entry ${n} needs "id", or "video" with "at", to name the Clip Mockup it changes`,
          ENTITY
        );
      }

      const frame = yield* readFrame(
        yield* text("html"),
        yield* text("image"),
        n,
        baseDir
      );
      if (say === undefined && frame === undefined) {
        return yield* parseError(
          `entry ${n} changes nothing: give it "say", "html" or "image"`,
          ENTITY
        );
      }
      parsed.push({
        target,
        line: say === undefined ? undefined : yield* requireLine(say, n),
        frame,
      });
    }
    yield* requireFramesExist(parsed.map((e) => e.frame));
    return parsed;
  });

/**
 * THE ONE WAY a page becomes a PNG, for `add`, `update` and `capture` alike:
 * every page at its `outputPath`, or a `FrameCaptureError` naming the first
 * page that failed.
 *
 * Pages are captured together, in the Clip Mockup daemon's one browser. The
 * `Effect.serviceOption` branch is the test seam: a suite provides a
 * `Layer.succeed` FrameCaptureService and no Chromium ever launches.
 */
export const capturePages = (
  pages: ReadonlyArray<{
    readonly htmlPath: string;
    readonly outputPath: string;
    readonly viewport: CaptureViewport;
    readonly fullPage: boolean;
  }>
) =>
  Effect.gen(function* () {
    if (pages.length === 0) return;
    const provided = yield* Effect.serviceOption(FrameCaptureService);
    yield* Option.match(provided, {
      onSome: (svc) =>
        Effect.forEach(pages, (page) => svc.captureHtmlToPng(page), {
          concurrency: "unbounded",
          discard: true,
        }),
      onNone: () => captureFramesInDaemon(pages),
    });
  });

/** A frame ready to go into a Video's Clip Mockup directory. */
export interface ProducedFrame {
  readonly content: Uint8Array;
  readonly filename: string;
}

/** The one key a frame is made once for: specs with one key share a file. */
const specKey = (spec: FrameSpec): string => {
  switch (spec.format) {
    case "landscape":
      return `landscape:${spec.source.path}`;
    case "short":
      return spec.scene === "camera"
        ? "short:camera"
        : `short:code:${spec.source.path}`;
  }
};

/** Read straight from disk: a Landscape PNG, which is already the frame. */
const copiedImage = (spec: FrameSpec): string | undefined =>
  spec.format === "landscape" && spec.source.kind === "image"
    ? spec.source.path
    : undefined;

/**
 * The PNG bytes for every frame, in order.
 *
 * Each distinct frame is read or captured ONCE, and gets one filename: a
 * frame held across four moments is one capture and one file, which the four
 * rows share. That is safe because a frame file is never changed or removed
 * — `update` writes a new one. Every Camera moment of a Short is the same
 * picture, so they share one too.
 *
 * A Landscape page is captured as it is, at 1920x1080. A Short's frame is a
 * page CVM writes into the scratch directory around the agent's page or PNG
 * (`shortFramePageHtml`), captured at 1080x1920. Pages go through
 * `capturePages`, all at once.
 */
export const produceFrames = (specs: ReadonlyArray<FrameSpec>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "cvm-frame-capture-" })
      .pipe(
        Effect.mapError(
          (cause) =>
            new FrameCaptureError({
              htmlPath: "",
              cause,
              message: "could not make a temp directory to capture frames in",
            })
        )
      );

    const distinct = [...new Map(specs.map((s) => [specKey(s), s])).entries()];
    const pages: Array<{
      key: string;
      /** What a failure names: the agent's page, or CVM's own for a Camera. */
      shownPath: string;
      htmlPath: string;
      outputPath: string;
      viewport: CaptureViewport;
      fullPage: false;
    }> = [];
    for (const [i, [key, spec]] of distinct.entries()) {
      if (copiedImage(spec) !== undefined) continue;
      const outputPath = nodePath.join(scratch, `${i}.png`);
      if (spec.format === "landscape") {
        pages.push({
          key,
          shownPath: spec.source.path,
          htmlPath: spec.source.path,
          outputPath,
          viewport: LANDSCAPE_FRAME,
          fullPage: false,
        });
        continue;
      }
      const htmlPath = nodePath.join(scratch, `${i}-short-${spec.scene}.html`);
      yield* fs.writeFileString(htmlPath, shortFramePageHtml(spec)).pipe(
        Effect.mapError(
          (cause) =>
            new FrameCaptureError({
              htmlPath,
              cause,
              message: `could not write the Short frame page ${htmlPath}`,
            })
        )
      );
      pages.push({
        key,
        shownPath: spec.scene === "code" ? spec.source.path : htmlPath,
        htmlPath,
        outputPath,
        viewport: SHORT_FRAME,
        fullPage: false,
      });
    }

    yield* capturePages(
      pages.map(({ htmlPath, outputPath, viewport, fullPage }) => ({
        htmlPath,
        outputPath,
        viewport,
        fullPage,
      }))
    ).pipe(
      // A Short's Code page failed inside CVM's wrapper: name the agent's
      // page, which is the one it can fix.
      Effect.mapError((e) => {
        const page = pages.find((p) => p.htmlPath === e.htmlPath);
        return page === undefined || page.shownPath === e.htmlPath
          ? e
          : new FrameCaptureError({
              htmlPath: page.shownPath,
              cause: e.cause,
              message: e.message.replaceAll(page.htmlPath, page.shownPath),
            });
      })
    );

    const pageOf = new Map(pages.map((p) => [p.key, p]));
    const byKey = new Map<string, ProducedFrame>();
    for (const [key, spec] of distinct) {
      const image = copiedImage(spec);
      const page = pageOf.get(key);
      const readFrom = image ?? page!.outputPath;
      const content = yield* fs.readFile(readFrom).pipe(
        Effect.mapError((cause) =>
          image === undefined
            ? new FrameCaptureError({
                htmlPath: page!.shownPath,
                cause,
                message:
                  "the capture reported success but wrote no PNG — refusing to create a Clip Mockup with no frame",
              })
            : parseError(`cannot read source image ${image}`, ENTITY)
        )
      );
      byKey.set(key, {
        content,
        // A captured frame is stored as a PNG whatever the page was called.
        filename: newFrameFilename(image ?? "frame.png"),
      });
    }
    return specs.map((s) => byKey.get(specKey(s))!);
  }).pipe(Effect.scoped);
