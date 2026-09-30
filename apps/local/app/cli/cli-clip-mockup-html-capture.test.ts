import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  FrameCaptureError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeTempClipMockupDir,
  ndjson,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import {
  addArgv,
  fakeSpeech,
  updateArgv,
} from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup add/update, "html" entries: capture a frame from a page
//
// The capture is the ONE thing in this feature that cannot run in a test: it
// drives a real headless browser. So FrameCaptureService is faked with
// Layer.succeed the way cli-footage-writes.test.ts fakes VideoProcessingService
// — the command branches on Effect.serviceOption, finds the fake and uses it,
// and NO CHROMIUM EVER LAUNCHES HERE. The fake writes canned bytes at exactly
// the path it was asked for, which is all the rest of the verb needs to be
// real: the copy into {CLIP_MOCKUP_DIR}/{lineageId}/, the row write, the
// ordering and the failure paths are the shipping code. Outside a test the
// same captures go to the Clip Mockup daemon's one browser; the fake is what
// keeps that daemon from ever starting here.
//
// Its own file rather than an addition to cli-clip-mockup-writes.test.ts
// because only this suite needs the fake layer — and because that file is
// already close to the repo's per-file token budget.
// ===========================================================================

/** What the fake does on its next call. Reset in beforeEach. */
let capture: {
  mode: "succeed" | "fail";
  bytes: string;
  calls: Array<{ htmlPath: string; outputPath: string }>;
} = { mode: "succeed", bytes: "CAPTURED-PNG", calls: [] };

const fakeFrameCapture = Layer.succeed(FrameCaptureService, {
  captureHtmlToPng: (params: {
    readonly htmlPath: string;
    readonly outputPath: string;
  }) =>
    Effect.suspend(() => {
      capture.calls.push(params);
      if (capture.mode === "fail") {
        return Effect.fail(
          new FrameCaptureError({
            htmlPath: params.htmlPath,
            cause: null,
            message: "the page would not render",
          })
        );
      }
      nodeFs.writeFileSync(params.outputPath, capture.bytes);
      return Effect.succeed(params.outputPath);
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
/**
 * `add` and `update` voice every "say" line (#1643), so this suite needs the
 * shared speech fake merged in beside the capture fake — otherwise every
 * write here would start the Clip Mockup daemon and load Kokoro. Neither
 * Chromium nor Kokoro ever runs in this file.
 */
const speech = fakeSpeech();
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
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
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-frame-html-"));
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  frames.cleanup();
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(frames.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(frames.dir, { recursive: true });
  capture = { mode: "succeed", bytes: "CAPTURED-PNG", calls: [] };
  speech.spoken.length = 0;
});

describe("cvm clip-mockup --html", () => {
  interface Mockup {
    id: string;
    videoId: string;
    line: string;
    imagePath: string;
    audioPath: string;
    imageFile: string;
    audioFile: string;
    durationSeconds: number | null;
    order: string;
    archived: boolean;
    createdAt: string;
  }

  /** The rows a batch printed. */
  const rowsOf = (stdout: string): Mockup[] => ndjson(stdout) as Mockup[];

  /** Add ONE moment from a page and hand back its row. */
  const addPage = async (html: string, say: string): Promise<Mockup> =>
    rowsOf(
      (await run(addArgv(s.standaloneActiveId, [{ say, html }]))).stdout
    )[0]!;

  const failureOf = (result: RunResult) =>
    JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

  /** Write an HTML page for the capture to be pointed at, returning its path. */
  const sourceHtml = (name: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, "<html><body>a moment</body></html>");
    return full;
  };

  const sourceImage = (name: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const frameDir = (lineageId: string) => nodePath.join(frames.dir, lineageId);

  const list = async (videoId: string): Promise<Mockup[]> =>
    ndjson(
      (await run(["clip-mockup", "list", "--video", videoId])).stdout
    ) as Mockup[];

  // -----------------------------------------------------------------------
  // add, "html"
  // -----------------------------------------------------------------------

  it("add captures the page and creates the Clip Mockup in one call", async () => {
    const html = sourceHtml("moment-01.html");
    const { stdout, stderr, exitCode } = await run(
      addArgv(s.standaloneActiveId, [{ say: "Here's the problem.", html }])
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const row = rowsOf(stdout)[0]!;
    expect(row.videoId).toBe(s.standaloneActiveId);
    expect(row.line).toBe("Here's the problem.");

    // The page it was asked to capture is the page we passed.
    expect(capture.calls.map((c) => c.htmlPath)).toEqual([html]);

    // The captured PNG lands in the Video's frame directory exactly the way a
    // supplied PNG does: a fresh .png name, stored RELATIVE to the store.
    expect(nodePath.isAbsolute(row.imagePath)).toBe(false);
    expect(row.imagePath.endsWith(".png")).toBe(true);
    const dir = frameDir(s.standaloneActiveLineageId);
    // Exactly one PNG — the captured one. The line's WAV sits beside it
    // (#1643), so count the pictures rather than the whole directory.
    expect(nodeFs.readdirSync(dir).filter((f) => f.endsWith(".png"))).toEqual([
      row.imagePath,
    ]);
    expect(nodeFs.readFileSync(nodePath.join(dir, row.imagePath), "utf8")).toBe(
      "CAPTURED-PNG"
    );
    // One capture AND one synthesis: the picture and the line are one entry.
    expect(speech.spoken).toEqual(["Here's the problem."]);
  });

  it("add captures every page of a batch, and a page used twice only once", async () => {
    const one = sourceHtml("batch-1.html");
    const two = sourceHtml("batch-2.html");

    const r = await run(
      addArgv(s.standaloneActiveId, [
        { say: "First.", html: one },
        { say: "Second.", html: two },
        { say: "Still on the first.", html: one },
      ])
    );

    expect(r.exitCode).toBe(0);
    const rows = rowsOf(r.stdout);
    expect(rows.map((m) => m.line)).toEqual([
      "First.",
      "Second.",
      "Still on the first.",
    ]);
    expect(capture.calls.map((c) => c.htmlPath).sort()).toEqual(
      [one, two].sort()
    );
    // The held page is one frame file, shared by both rows.
    expect(rows[2]!.imagePath).toBe(rows[0]!.imagePath);
    expect(rows[1]!.imagePath).not.toBe(rows[0]!.imagePath);
  });

  it("add leaves no scratch file behind once the frame is stored", async () => {
    await addPage(sourceHtml("moment-02.html"), "One line.");

    // The capture writes into a SCOPED temp directory; the only lasting copy
    // is the one inside the Clip Mockup store.
    const scratch = capture.calls[0]!.outputPath;
    expect(nodeFs.existsSync(scratch)).toBe(false);
    expect(nodeFs.existsSync(nodePath.dirname(scratch))).toBe(false);
  });

  it("captures at exactly 1920x1080", () => {
    expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([1920, 1080]);
  });

  // -----------------------------------------------------------------------
  // The one-picture rule
  // -----------------------------------------------------------------------

  it("add with an entry holding BOTH html and image is invalid input, exit 3, and writes nothing", async () => {
    const r = await run(
      addArgv(s.standaloneActiveId, [
        {
          say: "Two pictures.",
          html: sourceHtml("both.html"),
          image: sourceImage("both.png"),
        },
      ])
    );

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("ParseError");
    expect(failure.message).toContain('entry 1 has both "html" and "image"');
    // Rejected before anything was captured or written.
    expect(capture.calls).toEqual([]);
    expect(nodeFs.existsSync(frameDir(s.standaloneActiveLineageId))).toBe(
      false
    );
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add with an entry holding NEITHER html nor image is invalid input, exit 3", async () => {
    const r = await run(
      addArgv(s.standaloneActiveId, [{ say: "A moment with no picture." }])
    );

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain('"html"');
    expect(capture.calls).toEqual([]);
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("update with BOTH html and image is invalid input, exit 3, and changes nothing", async () => {
    const created = await addPage(sourceHtml("before.html"), "Before.");
    capture.calls = [];

    const r = await run(
      updateArgv([
        {
          id: created.id,
          html: sourceHtml("after.html"),
          image: sourceImage("after.png"),
        },
      ])
    );

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(capture.calls).toEqual([]);
    const rows = await list(s.standaloneActiveId);
    expect(rows[0]!.imagePath).toBe(created.imagePath);
  });

  // -----------------------------------------------------------------------
  // The capture failure path
  // -----------------------------------------------------------------------

  it("a page that cannot be captured is a NAMED error, and leaves no row and no file", async () => {
    capture.mode = "fail";

    const r = await run(
      addArgv(s.standaloneActiveId, [
        { say: "This one will not render.", html: sourceHtml("broken.html") },
      ])
    );

    // Named, not a blank frame: an agent can read this and fix its HTML.
    const failure = failureOf(r);
    expect(failure._tag).toBe("FrameCaptureError");
    expect(failure.message).toContain("would not render");
    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");

    // No row...
    expect(await list(s.standaloneActiveId)).toEqual([]);
    // ...and no file at all: not the frame, and not the line's WAV, although
    // the line was voiced while the page was failing. Nothing is written
    // until the whole batch has succeeded.
    expect(nodeFs.existsSync(frameDir(s.standaloneActiveLineageId))).toBe(
      false
    );
    const scratch = capture.calls[0]!.outputPath;
    expect(nodeFs.existsSync(nodePath.dirname(scratch))).toBe(false);
  });

  it("a capture that writes no PNG is a FrameCaptureError, not an empty frame", async () => {
    // The service "succeeded" but produced nothing. The verb refuses rather
    // than storing a zero-byte picture.
    capture.mode = "succeed";
    const broken = Layer.succeed(FrameCaptureService, {
      captureHtmlToPng: (p: {
        readonly htmlPath: string;
        readonly outputPath: string;
      }) =>
        Effect.sync(() => {
          capture.calls.push(p);
          return p.outputPath;
        }),
    } as unknown as FrameCaptureService);

    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(
        addArgv(s.standaloneActiveId, [
          { say: "Nothing came out.", html: sourceHtml("silent.html") },
        ])
      ).pipe(
        Effect.provide(out.layer),
        // The speech fake too: without it the line would go to the real daemon.
        Effect.provide(
          Layer.mergeAll(buildWriteLayer(testDb), broken, speech.layer)
        )
      )
    );

    expect(exitCode).toBe(4);
    expect(JSON.parse(out.stderr().trim())._tag).toBe("FrameCaptureError");
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add with a page that is not there is invalid input, and never captures", async () => {
    const missing = nodePath.join(sourceDir, "does-not-exist.html");
    const r = await run(
      addArgv(s.standaloneActiveId, [{ say: "Missing page.", html: missing }])
    );

    expect(r.exitCode).toBe(3);
    const failure = failureOf(r);
    expect(failure._tag).toBe("ParseError");
    expect(failure.message).toContain(
      `entry 1: cannot read source HTML ${missing}`
    );
    expect(capture.calls).toEqual([]);
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // update, "html"
  // -----------------------------------------------------------------------

  it("update re-captures the page and repoints the row, leaving the line alone", async () => {
    const created = await addPage(sourceHtml("v1.html"), "Number 14.");

    capture.bytes = "RECAPTURED-PNG";
    speech.spoken.length = 0;
    const r = await run(
      updateArgv([{ id: created.id, html: sourceHtml("v2.html") }])
    );

    expect(r.exitCode).toBe(0);
    const updated = rowsOf(r.stdout)[0]!;
    expect(updated.imagePath).not.toBe(created.imagePath);
    expect(updated.line).toBe("Number 14.");
    // A NEW PICTURE IS NOT NEW WORDS: swapping the frame never re-voices the
    // line, so the measured duration is the one 'add' wrote.
    expect(speech.spoken).toEqual([]);
    expect(updated.durationSeconds).toBe(created.durationSeconds);

    const dir = frameDir(s.standaloneActiveLineageId);
    expect(
      nodeFs.readFileSync(nodePath.join(dir, updated.imagePath), "utf8")
    ).toBe("RECAPTURED-PNG");
    // The old frame is left on disk — the row is the state.
    expect(nodeFs.existsSync(nodePath.join(dir, created.imagePath))).toBe(true);
  });

  it("update takes a page and a line in one entry", async () => {
    const created = await addPage(sourceHtml("both-v1.html"), "Too dense.");

    const updated = rowsOf(
      (
        await run(
          updateArgv([
            {
              id: created.id,
              html: sourceHtml("both-v2.html"),
              say: "Shorter.",
            },
          ])
        )
      ).stdout
    )[0]!;

    expect(updated.line).toBe("Shorter.");
    expect(updated.imagePath).not.toBe(created.imagePath);
  });

  // -----------------------------------------------------------------------
  // imageFile / audioFile: where the files really are
  // -----------------------------------------------------------------------

  /** The row's files, as ABSOLUTE paths that exist, beside its relative ones. */
  const expectFiles = (row: Mockup) => {
    const dir = frameDir(s.standaloneActiveLineageId);
    expect(row.imageFile).toBe(nodePath.join(dir, row.imagePath));
    expect(row.audioFile).toBe(nodePath.join(dir, row.audioPath));
    expect(nodePath.isAbsolute(row.imageFile)).toBe(true);
    expect(nodeFs.readFileSync(row.imageFile, "utf8")).toContain("PNG");
    expect(nodeFs.existsSync(row.audioFile)).toBe(true);
    // Additive: the relative fields are exactly as they always were.
    expect(nodePath.isAbsolute(row.imagePath)).toBe(false);
    expect(nodePath.isAbsolute(row.audioPath)).toBe(false);
  };

  it("add, list, get and update all print the absolute imageFile and audioFile", async () => {
    const added = await addPage(sourceHtml("files-1.html"), "Where is it?");
    expectFiles(added);

    const [listed] = await list(s.standaloneActiveId);
    expectFiles(listed!);

    const got = JSON.parse(
      (await run(["clip-mockup", "get", added.id])).stdout
    ) as Mockup;
    expectFiles(got);

    const updated = rowsOf(
      (
        await run(
          updateArgv([{ id: added.id, html: sourceHtml("files-2.html") }])
        )
      ).stdout
    )[0]!;
    expectFiles(updated);
    expect(updated.imageFile).not.toBe(added.imageFile);
  });

  it("list --with-chapters prints the files on Clip Mockup rows only", async () => {
    await run(
      addArgv(s.standaloneActiveId, [
        { chapter: "Part one" },
        { say: "A moment.", html: sourceHtml("files-3.html") },
      ])
    );
    const rows = ndjson(
      (
        await run([
          "clip-mockup",
          "list",
          "--with-chapters",
          "--video",
          s.standaloneActiveId,
        ])
      ).stdout
    ) as Array<Mockup & { type: string }>;

    expect(rows.map((r) => r.type)).toEqual([
      "clipMockupChapter",
      "clipMockup",
    ]);
    expect("imageFile" in rows[0]!).toBe(false);
    expectFiles(rows[1]!);
  });
});
