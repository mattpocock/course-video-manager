import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  FrameCaptureError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import { createTestDb, type TestDb } from "@/test-utils/pglite";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeTempClipMockupDir,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";
import { fakeSpeech } from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup capture: pages to PNGs, and nothing else
//
// The browser is faked with Layer.succeed exactly as in
// cli-clip-mockup-html-capture.test.ts: `capturePages` finds the fake through
// Effect.serviceOption, so no Chromium launches and no daemon starts. The fake
// writes canned bytes where it is told to, and records what it was asked —
// including the CONTENT of the contact sheet page, read while it still exists,
// since the sheet page lives in a scoped temp directory.
// ===========================================================================

interface Call {
  htmlPath: string;
  outputPath: string;
  fullPage: boolean;
  html: string;
}

let capture: { failOn: string | undefined; calls: Call[] } = {
  failOn: undefined,
  calls: [],
};

const fakeFrameCapture = Layer.succeed(FrameCaptureService, {
  captureHtmlToPng: (params: {
    readonly htmlPath: string;
    readonly outputPath: string;
    readonly fullPage: boolean;
  }) =>
    Effect.suspend(() => {
      capture.calls.push({
        ...params,
        html: nodeFs.readFileSync(params.htmlPath, "utf8"),
      });
      if (capture.failOn === params.htmlPath) {
        return Effect.fail(
          new FrameCaptureError({
            htmlPath: params.htmlPath,
            cause: null,
            message: `could not capture ${params.htmlPath} as a frame: boom`,
          })
        );
      }
      nodeFs.writeFileSync(params.outputPath, "CAPTURED-PNG");
      return Effect.succeed(params.outputPath);
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let pagesDir: string;
const speech = fakeSpeech();
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const layer = Layer.mergeAll(
    buildWriteLayer(testDb),
    fakeFrameCapture,
    speech.layer
  );
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
  frames = makeTempClipMockupDir();
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  frames.cleanup();
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

beforeEach(() => {
  pagesDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-capture-"));
  capture = { failOn: undefined, calls: [] };
  speech.spoken.length = 0;
});

/** Write a page and hand back its absolute path. */
const page = (name: string): string => {
  const full = nodePath.join(pagesDir, name);
  nodeFs.writeFileSync(full, `<html><body>${name}</body></html>`);
  return full;
};

const beside = (html: string) => html.replace(/\.html?$/, ".png");

const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim()) as { _tag: string; message: string };

describe("cvm clip-mockup capture", () => {
  it("writes <page>.png beside each page and prints one row per page, in order", async () => {
    const one = page("01.html");
    const two = page("02.html");

    const r = await run(["clip-mockup", "capture", two, one]);

    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(ndjson(r.stdout)).toEqual([
      { html: two, png: beside(two) },
      { html: one, png: beside(one) },
    ]);
    expect(nodeFs.readFileSync(beside(one), "utf8")).toBe("CAPTURED-PNG");
    expect(nodeFs.readFileSync(beside(two), "utf8")).toBe("CAPTURED-PNG");
    // A frame is the 1920x1080 viewport, exactly as 'add' captures it.
    expect(capture.calls.every((c) => c.fullPage === false)).toBe(true);
  });

  it("resolves a relative page to an absolute path", async () => {
    page("rel.html");
    const cwd = process.cwd();
    process.chdir(pagesDir);
    try {
      const r = await run(["clip-mockup", "capture", "rel.html"]);
      expect(ndjson(r.stdout)).toEqual([
        {
          html: nodePath.join(pagesDir, "rel.html"),
          png: nodePath.join(pagesDir, "rel.png"),
        },
      ]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("touches no Clip Mockup store and voices no line", async () => {
    await run(["clip-mockup", "capture", page("quiet.html")]);

    expect(nodeFs.readdirSync(frames.dir)).toEqual([]);
    expect(speech.spoken).toEqual([]);
  });

  it.each([
    [
      "after the pages",
      (p: string[], sheet: string) => [...p, "--sheet", sheet],
    ],
    [
      "before the pages",
      (p: string[], sheet: string) => ["--sheet", sheet, ...p],
    ],
    ["as --sheet=", (p: string[], sheet: string) => [...p, `--sheet=${sheet}`]],
  ])(
    "--sheet %s writes one contact sheet of every page, in order, labelled",
    async (_, argv) => {
      const a = page("a.html");
      const b = page("b.html");
      const sheet = nodePath.join(pagesDir, "out", "sheet.png");

      const r = await run([
        "clip-mockup",
        "capture",
        ...argv([b, a, b], sheet),
      ]);

      expect(r.exitCode).toBe(0);
      expect(ndjson(r.stdout)).toEqual([
        { html: b, png: beside(b) },
        { html: a, png: beside(a) },
        { html: b, png: beside(b) },
        { sheet },
      ]);
      expect(nodeFs.readFileSync(sheet, "utf8")).toBe("CAPTURED-PNG");

      // A page named twice is captured once, but gets a tile per mention.
      const pages = capture.calls.filter((c) => !c.fullPage);
      expect(pages.map((c) => c.htmlPath).sort()).toEqual([a, b].sort());

      // The sheet is captured LAST, full height, from a page of every tile in
      // the order given — each labelled with its 1-based index and file name.
      const sheetCall = capture.calls.at(-1)!;
      expect(sheetCall.fullPage).toBe(true);
      expect(sheetCall.outputPath).toBe(sheet);
      const labels = [...sheetCall.html.matchAll(/<b>(\d+)<\/b>([^<]+)</g)].map(
        (m) => `${m[1]} ${m[2]}`
      );
      expect(labels).toEqual(["1 b.html", "2 a.html", "3 b.html"]);
      const imgs = [...sheetCall.html.matchAll(/<img src="file:\/\/([^"]+)"/g)];
      expect(imgs.map((m) => m[1])).toEqual([beside(b), beside(a), beside(b)]);
      // The sheet page is scratch: gone once the sheet is written.
      expect(nodeFs.existsSync(sheetCall.htmlPath)).toBe(false);
    }
  );

  it("a page that will not render is a FrameCaptureError naming it, exit 4", async () => {
    const good = page("good.html");
    const bad = page("bad.html");
    capture.failOn = bad;

    const r = await run(["clip-mockup", "capture", good, bad]);

    expect(r.exitCode).toBe(4);
    expect(failureOf(r)._tag).toBe("FrameCaptureError");
    expect(failureOf(r).message).toContain(bad);
    expect(r.stdout).toBe("");
  });

  it.each([
    ["no page at all", () => []],
    ["a page that is not there", () => [nodePath.join(pagesDir, "nope.html")]],
    ["a page that is not .html", () => [page("frame.png.txt")]],
    ["a sheet that is not .png", () => [page("x.html"), "--sheet", "s.jpg"]],
    ["--sheet with no path", () => [page("y.html"), "--sheet"]],
    [
      "--sheet twice",
      () => ["--sheet", "a.png", page("z.html"), "--sheet", "b.png"],
    ],
    ["an unknown flag after the pages", () => [page("w.html"), "--big"]],
  ])("%s is invalid input, exit 3, and captures nothing", async (_, argv) => {
    const r = await run(["clip-mockup", "capture", ...argv()]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(capture.calls).toEqual([]);
  });
});
