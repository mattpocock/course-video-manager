import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { ShortOverlayRendererService } from "@/services/short-overlay-renderer";
import type { ShortOverlayProps } from "@/services/short-render-clips";
import { SidecarContextTest } from "@/services/sidecar-context";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeRun,
  one,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm footage frame / cvm clip frame
//
// The real ffmpeg on lavfi fixture Footage (no device), and a fake recorder
// service answering `/health` on its own port (RECORDER_SERVICE_URL), so the
// Still Gate can be held without Matt's recorder. Skipped with no ffmpeg.
// ===========================================================================

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** What the fake recorder's `/health` says. */
const recorder = { recording: false };
let recorderServer: http.Server;

/**
 * The overlay renderer at its process boundary (no test may drive Chromium):
 * each Chat Card a solid magenta box where the card sits, on exactly its
 * frames. The same drawing for the render's `.mov` and a frame's PNG, so the
 * two can only disagree on WHICH frame they are asked for.
 */
const cardBoxes = (props: ShortOverlayProps) =>
  props.chatCards
    .map(
      (card) =>
        `drawbox=x=${(props.width - card.width) / 2}:y=${card.top}:w=${card.width}:h=300:color=magenta:t=fill:replace=1` +
        `:enable='between(n,${card.startFrame},${card.startFrame + card.durationInFrames - 1})'`
    )
    .join(",");
const overlaySource = (props: ShortOverlayProps) =>
  `color=c=black@0:s=${props.width}x${props.height}:r=${props.fps}:d=${props.durationInFrames / props.fps},format=rgba${props.chatCards.length ? `,${cardBoxes(props)}` : ""}`;
const fakeOverlayRenderer = Layer.succeed(
  ShortOverlayRendererService,
  ShortOverlayRendererService.make({
    renderVideo: (props, out) =>
      Effect.sync(() => {
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          overlaySource(props),
          "-c:v",
          "png",
          "-pix_fmt",
          "rgba",
          out,
        ]);
      }),
    renderFrame: (props, frame, out) =>
      Effect.sync(() => {
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          overlaySource(props),
          "-vf",
          `select=eq(n\\,${frame})`,
          "-frames:v",
          "1",
          out,
        ]);
      }),
  })
);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let root: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeRun(
    Layer.merge(buildWriteLayer(testDb), fakeOverlayRenderer) as ReturnType<
      typeof buildWriteLayer
    >
  );
  recorderServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        service: "recorder",
        pid: 1,
        state: recorder.recording ? { kind: "recording" } : { kind: "open" },
        takesClosing: false,
      })
    );
  });
  await new Promise<void>((resolve) =>
    recorderServer.listen(0, "127.0.0.1", resolve)
  );
  const { port } = recorderServer.address() as AddressInfo;
  process.env.RECORDER_SERVICE_URL = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.RECORDER_SERVICE_URL;
  await new Promise((resolve) => recorderServer.close(resolve));
});

beforeEach(() => {
  recorder.recording = false;
  root = mkdtempSync(join(tmpdir(), "cvm-frame-"));
  mkdirSync(join(root, "raw-footage/imported"), { recursive: true });
  process.env.STORAGE_ROOTS = root;
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
  return () => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.STORAGE_ROOTS;
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  };
});

/** A 30 fps fixture under raw-footage/imported/: one colour per second. */
const fixture = (name: string, colours: string[], size = "320x240") => {
  const file = join(root, "raw-footage/imported", name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    ...colours.flatMap((c) => [
      "-f",
      "lavfi",
      "-i",
      `color=c=${c}:s=${size}:r=30:d=1`,
    ]),
    "-filter_complex",
    `${colours.map((_, i) => `[${i}:v]`).join("")}concat=n=${colours.length}:v=1:a=0[v]`,
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-qp",
    "0",
    "-pix_fmt",
    "yuv444p",
    file,
  ]);
  return `raw-footage/imported/${name}`;
};

/** A PNG's size. */
const sizeOf = (png: string) => {
  const [w, h] = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      png,
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split(",");
  return { width: Number(w), height: Number(h) };
};

/** The rgb of the pixel at (x, y) of an image (or a video's frame at `t`). */
const pixel = (file: string, x: number, y: number, t?: number) => [
  ...execFileSync("ffmpeg", [
    "-v",
    "error",
    ...(t === undefined ? [] : ["-ss", String(t)]),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `crop=1:1:${x}:${y},format=rgb24`,
    "-f",
    "rawvideo",
    "-",
  ]),
];

/** Each channel within `tolerance` of `rgb`: an encode moves a flat colour a little. */
const near = (actual: number[], rgb: number[], tolerance = 32) =>
  actual.every((v, i) => Math.abs(v - rgb[i]!) <= tolerance);

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

describe.skipIf(!hasFfmpeg)("cvm footage frame", () => {
  it("prints a PNG of the raw frame at t, at the Footage's own size", async () => {
    const source = fixture("two.mp4", ["red", "blue"]);

    const result = await run(["footage", "frame", "--at", "1.5", source]);

    expect(result.exitCode).toBe(0);
    const { path } = one<{ path: string }>(result.stdout);
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(sizeOf(path)).toEqual({ width: 320, height: 240 });
    expect(near(pixel(path, 160, 120), BLUE)).toBe(true);
    const early = one<{ path: string }>(
      (await run(["footage", "frame", "--at", "0.5", source])).stdout
    );
    expect(near(pixel(early.path, 160, 120), RED)).toBe(true);
  });

  it("is refused while the recorder records, and again works after the Stop", async () => {
    const source = fixture("held.mp4", ["red"]);
    recorder.recording = true;

    const held = await run(["footage", "frame", "--at", "0.5", source]);

    expect(held.exitCode).toBe(3);
    expect(JSON.parse(held.stderr)).toMatchObject({
      _tag: "StillHeldError",
      message: "No still while recording: ask again after the Stop",
    });
    expect(held.stdout).toBe("");
    recorder.recording = false;
    expect(
      (await run(["footage", "frame", "--at", "0.5", source])).exitCode
    ).toBe(0);
  });

  it.each([["-0.1"], ["1"], ["5"]])(
    "refuses a t of %s, outside the one-second Footage",
    async (at) => {
      const source = fixture("short.mp4", ["red"]);

      const result = await run(["footage", "frame", "--at", at, source]);

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr)._tag).toBe("FrameRefusedError");
    }
  );
});

// ---------------------------------------------------------------------------
// cvm clip frame
// ---------------------------------------------------------------------------

/** A 3 s 640x360 fixture under raw-footage/imported/, with a tone. */
const footage = (name: string, picture: string) => {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${picture}:s=640x360:r=30:d=3`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(root, "raw-footage/imported", name),
  ]);
  return `raw-footage/imported/${name}`;
};

/**
 * A Short of two Clips cut from one yellow file: the first untouched, the
 * second drawn from Footage Layers only — the left (red) half of a red and
 * green file as a square on top, a blue file as the band below — with a
 * Chat Card 0.2 s to 0.8 s into it.
 */
const seedShort = async () => {
  const base = footage("base.mp4", "yellow");
  const top = footage("top.mp4", "red");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    join(root, top),
    "-vf",
    "drawbox=x=320:y=0:w=320:h=360:color=lime:t=fill",
    "-c:a",
    "copy",
    join(root, "raw-footage/imported/halves.mp4"),
  ]);
  const face = footage("face.mp4", "blue");
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "Short", originalFootagePath: base, format: "short" })
    .returning();
  const clip = async (order: string, start: number) => {
    const [row] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: base,
        sourceStartTime: start,
        sourceEndTime: start + 1,
        order,
        text: "hello there",
      })
      .returning();
    return row!.id;
  };
  const first = await clip("a0", 0);
  const second = await clip("a1", 1);
  for (const argv of [
    [
      "--footage",
      "raw-footage/imported/halves.mp4",
      "--crop",
      "0,0,0.5,1",
      "--place",
      "0,0,1080,1080",
    ],
    ["--footage", face, "--place", "0,1080,1080,840"],
  ]) {
    expect(
      (await run(["clip", "layer", "add", ...argv, second])).exitCode
    ).toBe(0);
  }
  expect((await run(["clip", "layer", "remove", second, "0"])).exitCode).toBe(
    0
  );
  await testDb.insert(schema.overlays).values({
    clipId: second,
    at: 0.2,
    durationInSeconds: 0.6,
    kind: "chatCard",
    title: "viewer",
    description: "nice",
    disableEnterAnimation: true,
    disableExitAnimation: true,
  });
  return { videoId: video!.id, first, second };
};

/** The Short as `cvm short render` posts it, with the same fake overlay renderer. */
const renderShort = (videoId: string) => {
  const db = Layer.succeed(DrizzleService, testDb as never);
  const deps = Layer.mergeAll(
    VideoOperationsService.Default.pipe(Layer.provide(db)),
    ClipOperationsService.Default.pipe(Layer.provide(db)),
    FFmpegCommandsService.Default,
    FFmpegEncodeService.Default,
    Layer.succeed(VideoEditorLoggerService, {
      log: () => Effect.void,
    } as never),
    fakeOverlayRenderer,
    NodeContext.layer,
    SidecarContextTest,
    Layer.setConfigProvider(
      ConfigProvider.fromMap(new Map([["STORAGE_ROOTS", root]]))
    )
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* RenderVerticalVideoService;
      return yield* service.renderVerticalVideo({ videoId });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          deps,
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(deps)
          )
        )
      )
    )
  );
};

const YELLOW = [255, 255, 0];
const LIME = [0, 255, 0];
const MAGENTA = [255, 0, 255];
/** Probe points: in the card, beside it in the top square, and in the band. */
const CARD = [540, 400] as const;
const SQUARE = [540, 900] as const;
const BAND = [540, 1500] as const;

describe.skipIf(!hasFfmpeg)("cvm clip frame", () => {
  beforeEach(async () => {
    await truncateAllTables(testDb);
  });

  it("draws a Short's Clip as its render does: Footage Layers, then the Chat Card on its frames", async () => {
    const s = await seedShort();
    const exported = await renderShort(s.videoId);
    const frame = async (clip: string, at: string) => {
      const result = await run(["clip", "frame", "--at", at, clip]);
      expect(result.exitCode).toBe(0);
      return one<{ path: string }>(result.stdout).path;
    };

    const carded = await frame(s.second, "0.5");
    const before = await frame(s.second, "0.1");
    const opening = await frame(s.first, "0.5");

    expect(sizeOf(carded)).toEqual({ width: 1080, height: 1920 });
    // 0.5 s into the second Clip is 1.5 s into the Short.
    for (const [png, t, card] of [
      [carded, 1.5, MAGENTA],
      [before, 1.1, RED],
    ] as const) {
      expect(near(pixel(png, ...CARD), card)).toBe(true);
      expect(near(pixel(exported, ...CARD, t), card)).toBe(true);
      expect(near(pixel(png, ...SQUARE), RED)).toBe(true);
      expect(near(pixel(exported, ...SQUARE, t), RED)).toBe(true);
      expect(near(pixel(png, ...BAND), BLUE)).toBe(true);
      expect(near(pixel(exported, ...BAND, t), BLUE)).toBe(true);
    }
    expect(near(pixel(opening, ...BAND), YELLOW)).toBe(true);
    expect(near(pixel(exported, ...BAND, 0.5), YELLOW)).toBe(true);
    // The square is the left half only: none of the lime right half.
    expect(near(pixel(carded, 1070, 900), LIME)).toBe(false);
  }, 120_000);

  it("is refused while the recorder records", async () => {
    const s = await seedShort();
    recorder.recording = true;

    const held = await run(["clip", "frame", "--at", "0.5", s.second]);

    expect(held.exitCode).toBe(3);
    expect(JSON.parse(held.stderr)).toMatchObject({
      _tag: "StillHeldError",
      message: "No still while recording: ask again after the Stop",
    });
  });

  it.each([["-0.5"], ["1"], ["2.5"]])(
    "refuses a t of %s, outside the one-second Clip",
    async (at) => {
      const s = await seedShort();

      const result = await run(["clip", "frame", "--at", at, s.second]);

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr)._tag).toBe("FrameRefusedError");
    }
  );

  it("refuses a Clip on a Landscape Video", async () => {
    const s = await seedShort();
    await testDb.update(schema.videos).set({ format: "landscape" });

    const result = await run(["clip", "frame", "--at", "0.5", s.first]);

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr).message).toContain("Landscape");
  });
});
