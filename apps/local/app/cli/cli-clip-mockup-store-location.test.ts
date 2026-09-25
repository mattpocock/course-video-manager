import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  FrameCaptureError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import { fakeSpeech } from "./cli-clip-mockup-test-harness";

// ===========================================================================
// WHICH DIRECTORY A CLIP MOCKUP FRAME LANDS IN
//
// Every other clip-mockup suite pins CLIP_MOCKUP_DIR as a real environment
// variable, so none of them could see this: on the author's machine the
// setting lives ONLY in the repo-root `.env`, and `.env` is not loaded by tsx.
// `add` got away with it because `resolveClipMockupSpeech` calls loadRepoEnv()
// before the frame is written; `update --image` / `--html` never voices a line,
// so nothing had loaded the file by the time it wrote — and the frame went to
// the fallback store inside the checkout while the row pointed at a name the
// real store did not have.
//
// So this suite is the one that runs with CLIP_MOCKUP_DIR ABSENT from the
// environment and present only in a `.env`: repo-env is mocked to name a temp
// `.env` (and loadRepoEnv is a no-op, so the author's REAL `.env` can never be
// read into a test run). The assertion is the user-visible one — after the
// verb exits 0, the file the row names is on disk.
// ===========================================================================

const fixture = vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-store-location-"));
  const storeDir = path.join(root, "clip-mockups");
  const sourceDir = path.join(root, "sources");
  const envPath = path.join(root, ".env");
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  // The two settings `cvm clip-mockup` needs, in a file and NOWHERE else.
  fs.writeFileSync(
    envPath,
    `CVM_LOCAL_MACHINE="true"\nCLIP_MOCKUP_DIR="${storeDir}"\n`
  );

  return { root, storeDir, sourceDir, envPath };
});

vi.mock("@/services/repo-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/repo-env")>();
  const { envPath } = await fixture;

  // EVERY door into the `.env` is redirected at the temp file, not just
  // `repoEnvPath`: an intra-module call inside repo-env.ts would not see a
  // mocked export, so leaving `resolveRepoEnvValue` real would have this suite
  // read the AUTHOR'S `.env` and write its canned frames into the author's
  // own Clip Mockup store.
  return {
    ...actual,
    repoEnvPath: () => envPath,
    resolveRepoEnvValue: (key: string) =>
      process.env[key] != null && process.env[key] !== ""
        ? process.env[key]
        : actual.readEnvValue(envPath, key),
    // A no-op rather than the real loader, for the same reason — and because
    // the whole point here is that the verb must not need it to have run.
    loadRepoEnv: () => {},
  };
});

/** The frame-capture fake, so --html never launches Chromium. */
const capture: { bytes: string; calls: string[] } = {
  bytes: "CAPTURED-PNG",
  calls: [],
};

const fakeFrameCapture = Layer.succeed(FrameCaptureService, {
  captureHtmlToPng: (params: {
    readonly htmlPath: string;
    readonly outputPath: string;
  }) =>
    Effect.sync(() => {
      capture.calls.push(params.htmlPath);
      nodeFs.writeFileSync(params.outputPath, capture.bytes);
      return params.outputPath;
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let storeDir: string;
let sourceDir: string;
let root: string;
const speech = fakeSpeech();
const originalStore = process.env.CLIP_MOCKUP_DIR;

interface Mockup {
  id: string;
  line: string;
  imagePath: string;
}

const obj = (stdout: string): Mockup => one<Mockup>(stdout);

beforeAll(async () => {
  const paths = await fixture;
  root = paths.root;
  storeDir = paths.storeDir;
  sourceDir = paths.sourceDir;
  // THE CONDITION UNDER TEST: the setting is in the `.env` and not in the
  // environment, which is how the author's own machine is configured.
  delete process.env.CLIP_MOCKUP_DIR;

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
});

afterAll(() => {
  nodeFs.rmSync(root, { recursive: true, force: true });
  if (originalStore === undefined) {
    delete process.env.CLIP_MOCKUP_DIR;
  } else {
    process.env.CLIP_MOCKUP_DIR = originalStore;
  }
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  capture.bytes = "CAPTURED-PNG";
  capture.calls.length = 0;
  speech.spoken.length = 0;
});

describe("cvm clip-mockup with CLIP_MOCKUP_DIR only in the repo .env", () => {
  const sourceFile = (name: string, contents: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, contents);
    return full;
  };

  /** The absolute path the ROW claims its picture is at. */
  const framePath = (row: Mockup): string =>
    nodePath.join(storeDir, s.standaloneActiveLineageId, row.imagePath);

  const add = async (html: string, line: string): Promise<Mockup> => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      html,
      "--say",
      line,
    ]);
    expect(r.exitCode).toBe(0);
    return obj(r.stdout);
  };

  it("add writes its frame into the store the .env names", async () => {
    const created = await add(
      sourceFile("add.html", "<html><body>one</body></html>"),
      "The first moment."
    );
    expect(nodeFs.existsSync(framePath(created))).toBe(true);
  });

  it("update --html writes the re-captured frame to disk, not just the row", async () => {
    const created = await add(
      sourceFile("v1.html", "<html><body>v1</body></html>"),
      "Number 14."
    );

    capture.bytes = "RECAPTURED-PNG";
    const r = await run([
      "clip-mockup",
      "update",
      "--html",
      sourceFile("v2.html", "<html><body>v2</body></html>"),
      created.id,
    ]);

    expect(r.exitCode).toBe(0);
    const updated = obj(r.stdout);
    expect(updated.imagePath).not.toBe(created.imagePath);
    // The row points at a picture that EXISTS. A row naming a file that is not
    // there is the one state an authoring agent can neither see nor fix.
    expect(nodeFs.existsSync(framePath(updated))).toBe(true);
    expect(nodeFs.readFileSync(framePath(updated), "utf8")).toBe(
      "RECAPTURED-PNG"
    );
    // ...and it is the SAME store 'add' used, not a second one.
    expect(nodeFs.existsSync(framePath(created))).toBe(true);
  });

  it("update --image copies the supplied PNG to disk, not just the row", async () => {
    const created = await add(
      sourceFile("img-v1.html", "<html><body>v1</body></html>"),
      "Number 15."
    );

    const r = await run([
      "clip-mockup",
      "update",
      "--image",
      sourceFile("replacement.png", "REPLACEMENT-PNG"),
      created.id,
    ]);

    expect(r.exitCode).toBe(0);
    const updated = obj(r.stdout);
    expect(updated.imagePath).not.toBe(created.imagePath);
    expect(nodeFs.existsSync(framePath(updated))).toBe(true);
    expect(nodeFs.readFileSync(framePath(updated), "utf8")).toBe(
      "REPLACEMENT-PNG"
    );
  });

  it("update addressed by --video/--at lands in the store too", async () => {
    await add(sourceFile("at-v1.html", "<html><body>v1</body></html>"), "One.");

    const r = await run([
      "clip-mockup",
      "update",
      "--video",
      s.standaloneActiveId,
      "--at",
      "1",
      "--image",
      sourceFile("at-new.png", "AT-PNG"),
    ]);

    expect(r.exitCode).toBe(0);
    expect(nodeFs.readFileSync(framePath(obj(r.stdout)), "utf8")).toBe(
      "AT-PNG"
    );
  });

  it("a FrameCaptureError still leaves no orphan frame in that store", async () => {
    const broken = Layer.succeed(FrameCaptureService, {
      captureHtmlToPng: (p: { readonly htmlPath: string }) =>
        Effect.fail(
          new FrameCaptureError({
            htmlPath: p.htmlPath,
            cause: null,
            message: "the page would not render",
          })
        ),
    } as unknown as FrameCaptureService);

    const created = await add(
      sourceFile("keep.html", "<html><body>keep</body></html>"),
      "Keep this."
    );

    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram([
        "clip-mockup",
        "update",
        "--html",
        sourceFile("bad.html", "<html><body>bad</body></html>"),
        created.id,
      ]).pipe(
        Effect.provide(out.layer),
        Effect.provide(
          Layer.mergeAll(buildWriteLayer(testDb), broken, speech.layer)
        )
      )
    );

    expect(exitCode).toBe(4);
    const dir = nodePath.join(storeDir, s.standaloneActiveLineageId);
    expect(nodeFs.readdirSync(dir).filter((f) => f.endsWith(".png"))).toEqual([
      created.imagePath,
    ]);
  });
});
