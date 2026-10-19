import { describe, it, expect } from "vitest";
import nodeFs from "node:fs";
import nodePath from "node:path";
import {
  readSimpleDiagram,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  DIAGRAM_RENDERS,
  failureOf,
  ndjson,
  useDiagramCli,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm diagram create: simple-format JSON -> a NEW Diagram + a PNG to check
//
// The browser is faked with Layer.succeed, as in the clip-mockup suites: the
// command finds the fake through Effect.serviceOption, so no Chromium launches
// and no daemon starts. The fake writes canned bytes where it is told to and
// records the scene and app origin it was handed.
// ===========================================================================

const { render, db, dir, run, file } = useDiagramCli();

const DRAFT = {
  name: "Agent loop",
  shapes: [
    { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
    { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
    { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
    { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
    { type: "line", id: "rule", x1: 0, y1: 200, x2: 600, y2: 200 },
    { type: "icon", id: "bot", x: 76, y: -70, name: "bot" },
  ],
};

type Created = {
  id: string;
  url: string;
  snapshots: Array<{ id: string; image: string }>;
};

/** The Diagram's snapshots, oldest first. */
const snapshotsOf = (diagramId: string) =>
  db().query.diagramSnapshots.findMany({
    where: (s, { eq }) => eq(s.diagramId, diagramId),
    orderBy: (s, { asc }) => [asc(s.createdAt)],
  });

/** Agent loop, one step further: the box Matt reveals next. */
const STEP_2 = {
  shapes: [
    ...DRAFT.shapes,
    { type: "box", id: "memory", x: 800, y: 0, w: 200, h: 100 },
  ],
};

const { name: _name, ...DRAFT_SHAPES } = DRAFT;

describe("cvm diagram create", () => {
  it("keeps one drawing as a Preserved Snapshot, opens the Diagram on it, and prints {id, url, snapshots}", async () => {
    const r = await run(["diagram", "create", "--file", file(DRAFT)]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [line, ...rest] = ndjson(r.stdout) as Created[];
    expect(rest).toEqual([]);
    expect(Object.keys(line!).sort()).toEqual(["id", "snapshots", "url"]);

    const rows = await db().query.diagrams.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(line!.id).toBe(row.id);
    expect(row.name).toBe("Agent loop");
    expect(row.archived).toBe(false);

    const [snapshot, ...others] = await snapshotsOf(row.id);
    expect(others).toEqual([]);
    expect(snapshot!.preserved).toBe(true);
    // The snapshot is the scene the simple format builds, so it reads back as
    // exactly what was drawn — the arrow still bound to both boxes.
    expect(readSimpleDiagram((snapshot!.scene as Scene).store)).toEqual({
      shapes: DRAFT.shapes,
    });
    // The head is that snapshot, restored: the same drawing, held by it.
    expect(row.headScene).toEqual(snapshot!.scene);
    // Search finds the words on the canvas, like a Diagram drawn by hand.
    expect(row.searchText).toContain("Agent");
    expect(snapshot!.searchText).toContain("Agent");

    expect(line!.url).toBe(
      `http://localhost:5299/diagram-playground/${row.id}`
    );
    expect(line!.snapshots).toEqual([
      {
        id: snapshot!.id,
        image: nodePath.join(DIAGRAM_RENDERS, `${snapshot!.id}.png`),
      },
    ]);
    expect(nodeFs.readFileSync(line!.snapshots[0]!.image, "utf8")).toBe(
      "RENDERED-PNG"
    );
    nodeFs.rmSync(line!.snapshots[0]!.image);
  });

  it("keeps a batch as Preserved Snapshots IN ORDER, one PNG each, and opens the Diagram on the FIRST", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({ name: "Agent loop", snapshots: [DRAFT_SHAPES, STEP_2] }),
    ]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [line] = ndjson(r.stdout) as Created[];
    const [row, ...more] = await db().query.diagrams.findMany();
    expect(more).toEqual([]);
    expect(row!.name).toBe("Agent loop");

    const snapshots = await snapshotsOf(row!.id);
    expect(snapshots.map((s) => s.preserved)).toEqual([true, true]);
    expect(
      snapshots.map((s) => readSimpleDiagram((s.scene as Scene).store))
    ).toEqual([{ shapes: DRAFT.shapes }, { shapes: STEP_2.shapes }]);
    expect(row!.headScene).toEqual(snapshots[0]!.scene);

    expect(line!.snapshots.map((s) => s.id)).toEqual(
      snapshots.map((s) => s.id)
    );
    // Each PNG is the drawing of ITS snapshot.
    expect(render.calls.map((c) => c.scene)).toEqual(
      snapshots.map((s) => s.scene)
    );
    for (const { id, image } of line!.snapshots) {
      expect(image).toBe(nodePath.join(DIAGRAM_RENDERS, `${id}.png`));
      expect(nodeFs.existsSync(image)).toBe(true);
      nodeFs.rmSync(image);
    }
  });

  it("refuses a bad batch with every problem named by its snapshot, exit 3, and writes and draws nothing", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({
        name: "Agent loop",
        shapes: [],
        snapshots: [
          DRAFT_SHAPES,
          { shapes: [{ type: "triangle", id: "t" }] },
          { name: "step 3", shapes: [] },
          DRAFT_SHAPES,
        ],
      }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    const { message } = failureOf(r);
    expect(message).toContain("not both");
    expect(message).toContain(
      'snapshots[1]: shapes[0] ("t"): unknown type "triangle"'
    );
    expect(message).toContain('snapshots[2]: a snapshot has no "name"');
    expect(message).toContain(
      "snapshots[3]: draws exactly what snapshots[0] draws"
    );
    expect(await db().query.diagrams.findMany()).toEqual([]);
    expect(render.calls).toEqual([]);
  });

  it("refuses an empty batch, exit 3", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({ snapshots: [] }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("at least one");
    expect(await db().query.diagrams.findMany()).toEqual([]);
  });

  it("draws the very scene it stores, through the app at CVM_APP_URL", async () => {
    await run(["diagram", "create", "--file", file(DRAFT)]);

    const [snapshot] = await db().query.diagramSnapshots.findMany();
    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]!.appUrl).toBe("http://localhost:5299");
    expect(render.calls[0]!.scene).toEqual(snapshot!.scene);
    expect(render.calls[0]!.outputPath.startsWith(DIAGRAM_RENDERS)).toBe(true);
  });

  it("names a Diagram with no name 'Untitled N', like the playground", async () => {
    const { name: _, ...unnamed } = DRAFT;
    const r = await run(["diagram", "create", "--file", file(unnamed)]);

    expect(r.exitCode).toBe(0);
    const [row] = await db().query.diagrams.findMany();
    expect(row!.name).toBe("Untitled 1");
  });

  it("takes a size on a box, ellipse, arrow and line, as on text", async () => {
    const sized = {
      shapes: DRAFT.shapes.map((s) =>
        ["box", "ellipse", "arrow", "line"].includes(s.type)
          ? { ...s, size: "xl" }
          : s
      ),
    };
    const r = await run(["diagram", "create", "--file", file(sized)]);

    expect(r.exitCode).toBe(0);
    const [snapshot] = await db().query.diagramSnapshots.findMany();
    expect(readSimpleDiagram((snapshot!.scene as Scene).store)).toEqual(sized);
  });

  it("reports EVERY problem at once, exit 3, and writes and draws nothing", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({
        shapes: [
          { type: "box", id: "a", x: 0, y: 0, w: 100, h: 50 },
          { type: "triangle", id: "t" },
          { type: "icon", id: "i", x: 0, y: 0, name: "not-an-icon" },
          { type: "arrow", id: "x", from: "a", to: "ghost" },
          { type: "box", id: "a", x: 0, y: 0, w: 10, h: 10, colour: "red" },
        ],
      }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("ParseError");
    expect(failure.message).toContain('unknown type "triangle"');
    expect(failure.message).toContain('unknown icon "not-an-icon"');
    expect(failure.message).toContain('points at "ghost"');
    expect(failure.message).toContain('unknown field "colour"');
    expect(await db().query.diagrams.findMany()).toEqual([]);
    expect(render.calls).toEqual([]);
  });

  it("refuses a file that is not JSON, exit 3", async () => {
    const r = await run(["diagram", "create", "--file", file("{ nope")]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("is not valid JSON");
  });

  it("refuses an `other` shape: create only ever makes a new Diagram", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({ shapes: [{ type: "other", id: "kept" }] }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain('other "kept"');
    expect(await db().query.diagrams.findMany()).toEqual([]);
  });

  it("writes nothing when the PNG cannot be drawn (exit 4, DiagramRenderError), so a retry never duplicates", async () => {
    render.fail = true;

    const r = await run(["diagram", "create", "--file", file(DRAFT)]);

    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("DiagramRenderError");
    expect(await db().query.diagrams.findMany()).toEqual([]);
    expect(await db().query.diagramSnapshots.findMany()).toEqual([]);
  });

  it("is local-only: refused with exit 7 before the file is even read", async () => {
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const r = await run([
      "diagram",
      "create",
      "--file",
      nodePath.join(dir(), "missing.json"),
    ]);

    expect(r.exitCode).toBe(7);
    expect(failureOf(r)._tag).toBe("LocalOnlyCommandError");
    expect(render.calls).toEqual([]);
  });
});
