import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import { ShortOverlayRendererService } from "@/services/short-overlay-renderer";
import {
  OverlayFrameService,
  type OverlayRendererProps,
} from "@/services/overlay-frame";
import type { ShortOverlayProps } from "@/services/short-render-clips";
import type { OverlayContentProps } from "@/services/overlay-content-props";
import { LOCAL_MACHINE_ENV_KEY } from "@/cli/env";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "@/cli/cli-write-test-harness";

// ===========================================================================
// cvm footage frame / cvm clip frame
//
// The real ffmpeg on lavfi fixture Footage (no device), and a fake recorder
// service answering `/health` on its own port (RECORDER_SERVICE_URL), so the
// Still Gate can be held without Matt's recorder. Skipped with no ffmpeg.
// ===========================================================================

export const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** What the fake recorder's `/health` says. */
export const recorder = { recording: false };
let recorderServer: http.Server;

/**
 * The overlay renderer at its process boundary (no test may drive Chromium):
 * each Chat Card a solid magenta box where the card sits, on exactly its
 * frames; a Definition Card a magenta box top right, a Bullet Panel a cyan
 * box bottom right, on theirs. The same drawing for the render's `.mov` (a
 * Short's overlay, or an Overlay's content render) and a frame's PNG, so the
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
const contentBoxes = (props: OverlayContentProps) =>
  [
    ...props.definitionCards.map(
      (card) => ["x=1300:y=100:w=500:h=300:color=magenta", card] as const
    ),
    ...props.bulletPanels.map(
      (panel) => ["x=1700:y=880:w=200:h=180:color=cyan", panel] as const
    ),
  ]
    .map(
      ([box, { startFrame, durationInFrames }]) =>
        `drawbox=${box}:t=fill:replace=1:enable='between(n,${startFrame},${startFrame + durationInFrames - 1})'`
    )
    .join(",");
export const overlaySource = (props: OverlayRendererProps) => {
  const boxes = "chatCards" in props ? cardBoxes(props) : contentBoxes(props);
  return `color=c=black@0:s=${props.width}x${props.height}:r=${props.fps}:d=${props.durationInFrames / props.fps},format=rgba${boxes ? `,${boxes}` : ""}`;
};
/** The overlay frames `clip frame` asked for, in order. */
export const framesDrawn: number[] = [];
const fakeOverlayVideo = Layer.succeed(
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
  })
);
const fakeOverlayFrame = Layer.succeed(
  OverlayFrameService,
  OverlayFrameService.make({
    renderFrame: (props, frame, out) =>
      Effect.sync(() => {
        framesDrawn.push(frame);
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

export const fakeOverlayRenderer = Layer.merge(
  fakeOverlayVideo,
  fakeOverlayFrame
);

/** The test database, the `cvm` runner and this test's Storage Root. */
export const ctx = {} as {
  testDb: TestDb;
  run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
  root: string;
};

/** The hooks every frame test file runs: the database, the fake recorder, a fresh Storage Root. */
export const setupFrameTests = () => {
  beforeAll(async () => {
    ctx.testDb = (await createTestDb()).testDb;
    ctx.run = makeRun(
      Layer.merge(
        buildWriteLayer(ctx.testDb),
        fakeOverlayRenderer
      ) as ReturnType<typeof buildWriteLayer>
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
    framesDrawn.length = 0;
    ctx.root = mkdtempSync(join(tmpdir(), "cvm-frame-"));
    mkdirSync(join(ctx.root, "raw-footage/imported"), { recursive: true });
    process.env.STORAGE_ROOTS = ctx.root;
    process.env[LOCAL_MACHINE_ENV_KEY] = "true";
    return () => {
      rmSync(ctx.root, { recursive: true, force: true });
      delete process.env.STORAGE_ROOTS;
      delete process.env[LOCAL_MACHINE_ENV_KEY];
    };
  });
};

/** A 30 fps fixture under raw-footage/imported/: one colour per second. */
export const fixture = (name: string, colours: string[], size = "320x240") => {
  const file = join(ctx.root, "raw-footage/imported", name);
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
export const sizeOf = (png: string) => {
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
export const pixel = (file: string, x: number, y: number, t?: number) => [
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
export const near = (actual: number[], rgb: number[], tolerance = 32) =>
  actual.every((v, i) => Math.abs(v - rgb[i]!) <= tolerance);

export const RED = [255, 0, 0];
export const BLUE = [0, 0, 255];

/** A 3 s 640x360 fixture under raw-footage/imported/, with a tone. */
export const footage = (name: string, picture: string) => {
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
    join(ctx.root, "raw-footage/imported", name),
  ]);
  return `raw-footage/imported/${name}`;
};

export const YELLOW = [255, 255, 0];
export const MAGENTA = [255, 0, 255];
