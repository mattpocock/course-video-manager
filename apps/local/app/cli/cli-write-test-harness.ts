import { afterAll, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  DiagramRenderError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import { APP_URL_ENV_KEY, LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildRemoteLayer,
  type RemoteHarnessOptions,
} from "./cli-remote-test-harness";
import { toDate } from "@/packages/clock";

/**
 * Shared harness for the `cvm` WRITE-verb integration tests. Mirrors the layer
 * + run() plumbing of cli-integration.test.ts, but lives in its own module so
 * the write-verb suites can be split across small test files (the main
 * integration test file is already at the repo's per-file token budget). Same
 * contract: run the REAL buildProgram over PGlite with a captured CliOutput,
 * asserting { stdout, stderr, exitCode } — no subprocess.
 */
export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Mirrors ./layer.ts exactly: every verb group over HTTP, nothing in-process.
 * The only difference is where the deployed app's database comes from.
 */
export const buildWriteLayer = (
  db: TestDb,
  options: RemoteHarnessOptions = {}
) => buildRemoteLayer(db, options);

/** A run() bound to a specific captured-output layer. */
export const makeRun =
  (layer: ReturnType<typeof buildWriteLayer>) =>
  async (argv: ReadonlyArray<string>): Promise<RunResult> => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };

/** Parse NDJSON stdout into an array of objects (one per non-empty line). */
export const ndjson = (stdout: string): unknown[] =>
  stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

/** Parse a write verb's single pretty-printed JSON object. */
export const one = <T = Record<string, unknown>>(stdout: string): T =>
  JSON.parse(stdout) as T;

/** The Video row every `cvm video` write verb echoes, as its tests read it. */
export interface CliVideo {
  id: string;
  title: string;
  lessonId: string | null;
  pitchId: string | null;
  archived: boolean;
  body: string | null;
  description: string | null;
}

/** Parse a `cvm video` write verb's echoed row. */
export const videoObj = (stdout: string): CliVideo => one<CliVideo>(stdout);

/**
 * Point STORAGE_ROOTS at a fresh temp Storage Root for the duration of a
 * suite; `dir` is its `video-files/`, where Video Files are written. The
 * legacy store (VIDEO_FILES_DIR) is pointed at an empty folder beside it.
 *
 * `buildProgram` provides the REAL FileSystem, so without this any test that
 * exercises `cvm file` would write into the author's real store.
 */
export const makeTempVideoFilesDir = (): {
  readonly dir: string;
  readonly cleanup: () => void;
} => {
  const previousRoots = process.env.STORAGE_ROOTS;
  const previousLegacy = process.env.VIDEO_FILES_DIR;
  const root = nodeFs.mkdtempSync(
    nodePath.join(os.tmpdir(), "cvm-video-files-")
  );
  const dir = nodePath.join(root, "video-files");
  nodeFs.mkdirSync(dir);
  process.env.STORAGE_ROOTS = root;
  process.env.VIDEO_FILES_DIR = nodePath.join(root, "legacy-video-files");

  const restore = (key: string, previous: string | undefined) => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
  return {
    dir,
    cleanup: () => {
      nodeFs.rmSync(root, { recursive: true, force: true });
      restore("STORAGE_ROOTS", previousRoots);
      restore("VIDEO_FILES_DIR", previousLegacy);
    },
  };
};

/**
 * Point STORAGE_ROOTS at a fresh temp Storage Root for the duration of a
 * suite; `dir` is its `clip-mockups/`, where frames are written.
 *
 * Same reason as {@link makeTempVideoFilesDir}, different directory: Clip
 * Mockup frames are deliberately NOT under VIDEO_FILES_DIR, and without this a
 * `cvm clip-mockup` test would write PNGs into the author's real store.
 */
export const makeTempClipMockupDir = (): {
  readonly dir: string;
  readonly cleanup: () => void;
} => {
  const previous = process.env.STORAGE_ROOTS;
  const root = nodeFs.mkdtempSync(
    nodePath.join(os.tmpdir(), "cvm-clip-mockups-")
  );
  const dir = nodePath.join(root, "clip-mockups");
  nodeFs.mkdirSync(dir);
  process.env.STORAGE_ROOTS = root;

  return {
    dir,
    cleanup: () => {
      nodeFs.rmSync(root, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.STORAGE_ROOTS;
      } else {
        process.env.STORAGE_ROOTS = previous;
      }
    },
  };
};

export interface WriteSeed {
  draftSectionId: string;
  lessonId: string;
  lessonVideoId: string;
  lessonVideoLineageId: string;
  standaloneActiveId: string;
  standaloneActiveLineageId: string;
  standaloneArchivedId: string;
  pitchActiveId: string;
  pitchArchivedId: string;
}

/**
 * Minimal fixture for the write-verb suites: one course → draft version →
 * section → lesson → lesson-bound video, plus a standalone video and an active
 * + archived pitch. Enough to exercise every create/move/update/link path.
 */
export const seedWrite = async (db: TestDb): Promise<WriteSeed> => {
  const [course] = await db
    .insert(schema.courses)
    .values({ name: "Alpha", slug: "alpha" })
    .returning();
  const [draftVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "",
      createdAt: toDate("2024-01-01T00:00:00Z"),
    })
    .returning();
  const [draftSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      title: "Welcome",
      order: 1,
      authoringStatus: "done",
    })
    .returning();
  const [lessonVideo] = await db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();
  const [standaloneActive] = await db
    .insert(schema.videos)
    .values({ title: "standalone-active.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [standaloneArchived] = await db
    .insert(schema.videos)
    .values({
      title: "standalone-archived.mp4",
      originalFootagePath: "f.mp4",
      archived: true,
    })
    .returning();
  const [pitchActive] = await db
    .insert(schema.pitches)
    .values({ title: "Active pitch" })
    .returning();
  const [pitchArchived] = await db
    .insert(schema.pitches)
    .values({ title: "Archived pitch", archived: true })
    .returning();

  return {
    draftSectionId: draftSection!.id,
    lessonId: lesson!.id,
    lessonVideoId: lessonVideo!.id,
    lessonVideoLineageId: lessonVideo!.lineageId,
    standaloneActiveId: standaloneActive!.id,
    standaloneActiveLineageId: standaloneActive!.lineageId,
    standaloneArchivedId: standaloneArchived!.id,
    pitchActiveId: pitchActive!.id,
    pitchArchivedId: pitchArchived!.id,
  };
};

export interface DiagramRenderCall {
  appUrl: string;
  scene: unknown;
  outputPath: string;
}

/** Where `cvm diagram` writes its PNGs. */
export const DIAGRAM_RENDERS = nodePath.join(
  os.tmpdir(),
  "cvm-diagram-renders"
);

/**
 * The `cvm diagram` suites' harness. Call once at the top of a test file: it
 * registers the hooks (a PGlite db, CVM_APP_URL, local-machine on, a fresh
 * temp dir and an empty diagrams table before each test).
 *
 * The browser is faked with Layer.succeed, as in the clip-mockup suites: the
 * command finds the fake through Effect.serviceOption, so no Chromium launches
 * and no daemon starts. The fake writes canned bytes where it is told to and
 * records each call in `render.calls`; set `render.fail` to make it fail.
 */
export const useDiagramCli = () => {
  const render: { fail: boolean; calls: DiagramRenderCall[] } = {
    fail: false,
    calls: [],
  };
  const fakeRender = Layer.succeed(FrameCaptureService, {
    renderDiagramToPng: (params: DiagramRenderCall) =>
      Effect.suspend(() => {
        render.calls.push(params);
        if (render.fail) {
          return Effect.fail(
            new DiagramRenderError({
              cause: null,
              message:
                "could not render the Diagram: net::ERR_CONNECTION_REFUSED",
            })
          );
        }
        nodeFs.writeFileSync(params.outputPath, "RENDERED-PNG");
        return Effect.succeed(params.outputPath);
      }),
  } as unknown as FrameCaptureService);

  let testDb: TestDb;
  let runIn: (argv: ReadonlyArray<string>) => Promise<RunResult>;
  let dir: string;
  const saved = {
    local: process.env[LOCAL_MACHINE_ENV_KEY],
    app: process.env[APP_URL_ENV_KEY],
  };
  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeAll(async () => {
    testDb = (await createTestDb()).testDb;
    runIn = makeRun(Layer.merge(buildWriteLayer(testDb), fakeRender));
    process.env[APP_URL_ENV_KEY] = "http://localhost:5299/";
  });

  afterAll(() => {
    restoreEnv(LOCAL_MACHINE_ENV_KEY, saved.local);
    restoreEnv(APP_URL_ENV_KEY, saved.app);
  });

  beforeEach(async () => {
    process.env[LOCAL_MACHINE_ENV_KEY] = "true";
    dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-diagram-"));
    render.fail = false;
    render.calls = [];
    await testDb.delete(schema.diagrams);
  });

  return {
    render,
    db: () => testDb,
    dir: () => dir,
    run: (argv: ReadonlyArray<string>) => runIn(argv),
    /** Write `body` (JSON, or a raw string as-is) to the test's diagram.json. */
    file: (body: unknown): string => {
      const path = nodePath.join(dir, "diagram.json");
      nodeFs.writeFileSync(
        path,
        typeof body === "string" ? body : JSON.stringify(body)
      );
      return path;
    },
  };
};

/** A failed `cvm` run's stderr, parsed. */
export const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim()) as { _tag: string; message: string };
