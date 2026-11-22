import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  applySimpleDiagram,
  type SimpleShape,
} from "@cvm/core/lib/simple-diagram/index";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { ndjson, useDiagramCli } from "./cli-write-test-harness";
import { toDate } from "@/packages/clock";

// ===========================================================================
// cvm diagram list / cvm diagram component list: READ-ONLY views of Matt's
// Diagrams and Components. Diagrams are made with the real `create` (browser
// faked), Components seeded as the playground saves them.
// ===========================================================================

const { db, run, file } = useDiagramCli();

type Listed = {
  id: string;
  name: string;
  snapshotCount: number;
  filmed: boolean;
  url: string;
  archived?: boolean;
  matched?: {
    name: boolean;
    head?: string;
    snapshots: Array<{ id: string; text: string }>;
  };
};
type Created = { id: string; url: string; snapshots: Array<{ id: string }> };

const box = (id: string, x = 0): SimpleShape => ({
  type: "box",
  id,
  x,
  y: 0,
  w: 200,
  h: 100,
});
const text = (id: string, words: string): SimpleShape => ({
  type: "text",
  id,
  x: 20,
  y: 30,
  text: words,
});

const create = async (name: string, snapshots: SimpleShape[][]) => {
  const r = await run([
    "diagram",
    "create",
    "--file",
    file({ name, snapshots: snapshots.map((shapes) => ({ shapes })) }),
  ]);
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout)[0] as Created;
};

/** A clip on a fresh video, pinning `snapshotId`. */
const pin = async (snapshotId: string, archived = false) => {
  const [video] = await db()
    .insert(schema.videos)
    .values({ title: "v.mp4", originalFootagePath: "f.mp4" })
    .returning();
  await db().insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "a.mp4",
    sourceStartTime: 0,
    sourceEndTime: 1,
    order: "0001",
    text: "hello",
    archived,
    diagramSnapshotId: snapshotId,
  });
};

const list = async (...args: string[]) => {
  const r = await run(["diagram", "list", ...args]);
  expect(r.stderr).toBe("");
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout) as Listed[];
};

const everything = async () => ({
  diagrams: await db().query.diagrams.findMany(),
  snapshots: await db().query.diagramSnapshots.findMany(),
  components: await db().query.diagramComponents.findMany(),
});

beforeEach(async () => {
  await db().delete(schema.diagramComponents);
});

describe("cvm diagram list", () => {
  it("lists each Diagram's name, snapshot count and whether a live Clip pins one", async () => {
    const filmed = await create("Agent loop", [
      [box("a")],
      [box("a"), box("b", 300)],
    ]);
    const unfilmed = await create("Scratch", [[box("a")]]);
    const archivedPin = await create("Cut", [[box("a")]]);
    await pin(filmed.snapshots[1]!.id);
    await pin(archivedPin.snapshots[0]!.id, true);
    const before = await everything();

    const rows = await list();

    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["Agent loop"]).toEqual({
      id: filmed.id,
      name: "Agent loop",
      snapshotCount: 2,
      filmed: true,
      url: filmed.url,
    });
    expect(byName["Scratch"]).toMatchObject({
      id: unfilmed.id,
      snapshotCount: 1,
      filmed: false,
    });
    expect(byName["Cut"]).toMatchObject({ filmed: false });
    expect(await everything()).toEqual(before);
  });

  it("hides archived Diagrams unless --archived", async () => {
    const gone = await create("Gone", [[box("a")]]);
    await create("Here", [[box("a")]]);
    await run(["diagram", "delete", gone.id]);

    expect((await list()).map((r) => r.name)).toEqual(["Here"]);
    const all = await list("--archived");
    expect(all.map((r) => [r.name, r.archived]).sort()).toEqual([
      ["Gone", true],
      ["Here", false],
    ]);
  });

  it("searches names and snapshot words with the palette's search, and says what matched", async () => {
    const byWords = await create("Untitled", [
      [box("a"), text("t", "The context window fills up")],
      [box("a"), text("t", "Tokens in, tokens out")],
    ]);
    const byName = await create("Context engineering", [[box("a")]]);
    await create("Unrelated", [[box("a"), text("t", "Something else")]]);

    const rows = await list("context");

    expect(rows.map((r) => r.id).sort()).toEqual(
      [byWords.id, byName.id].sort()
    );
    const words = rows.find((r) => r.id === byWords.id)!;
    expect(words.matched!.name).toBe(false);
    expect(words.matched!.snapshots).toEqual([
      {
        id: byWords.snapshots[0]!.id,
        text: expect.stringContaining("context window"),
      },
    ]);
    const name = rows.find((r) => r.id === byName.id)!;
    expect(name.matched).toEqual({ name: true, snapshots: [] });
  });

  it("prints nothing when no Diagram matches", async () => {
    await create("Agent loop", [[box("a")]]);
    expect(await list("zebra")).toEqual([]);
  });

  it("is not local-only: it only reads", async () => {
    await create("Agent loop", [[box("a")]]);
    delete process.env[LOCAL_MACHINE_ENV_KEY];
    expect(await list()).toHaveLength(1);
  });
});

describe("cvm diagram component list", () => {
  /** A Component as the playground saves one: tldraw's copied content. */
  const seed = async (name: string, shapes: SimpleShape[]) => {
    const applied = applySimpleDiagram(null, { shapes });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    const records = Object.values(applied.scene.store);
    const [row] = await db()
      .insert(schema.diagramComponents)
      .values({
        name,
        sceneFragment: {
          shapes: records.filter((r) => r.typeName === "shape"),
          bindings: records.filter((r) => r.typeName === "binding"),
          rootShapeIds: [],
          assets: [],
          schema: applied.scene.schema,
        },
      })
      .returning();
    return row!;
  };

  const SHAPES: SimpleShape[] = [
    box("agent"),
    text("label", "Agent"),
    box("tools", 400),
    { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
  ];

  it("prints each Component's shapes in the simple format, round-tripped", async () => {
    const saved = await seed("Agent and tools", SHAPES);
    const before = await everything();

    const r = await run(["diagram", "component", "list"]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    // Fresh ids, the arrow following them; everything else as saved.
    const [listed] = ndjson(r.stdout) as Array<{ shapes: SimpleShape[] }>;
    const ids = listed!.shapes.map((s) => s.id);
    expect(listed).toEqual({
      id: saved.id,
      name: "Agent and tools",
      shapes: [
        { ...SHAPES[0], id: ids[0] },
        { ...SHAPES[1], id: ids[1] },
        { ...SHAPES[2], id: ids[2] },
        { ...SHAPES[3], id: ids[3], from: ids[0], to: ids[2] },
      ],
    });
    expect(ids.filter((id) => SHAPES.some((s) => s.id === id))).toEqual([]);
    // A look is not a use: lastUsedAt is untouched.
    expect(await everything()).toEqual(before);
  });

  it("mints fresh ids on every run, so one Component pastes twice into a Diagram", async () => {
    await seed("Agent and tools", SHAPES);
    const copy = async (dy: number) => {
      const r = await run(["diagram", "component", "list"]);
      const [c] = ndjson(r.stdout) as Array<{ shapes: SimpleShape[] }>;
      return c!.shapes.map((s) => ("y" in s ? { ...s, y: s.y + dy } : s));
    };
    const first = await copy(0);
    // The Diagram the Component was saved from: its ids are the Component's.
    const created = await create("Source", [[...SHAPES, ...first]]);
    const second = await copy(300);

    const added = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file({ shapes: [...SHAPES, ...first, ...second] }),
      created.id,
    ]);

    expect(added.stderr).toBe("");
    expect(added.exitCode).toBe(0);
    const got = ndjson(
      (await run(["diagram", "get", created.id])).stdout
    )[0] as {
      head: { shapes: SimpleShape[] };
    };
    const arrows = got.head.shapes.filter((s) => s.type === "arrow");
    expect(arrows).toHaveLength(3);
    for (const [arrow, from] of [
      [arrows[1], first],
      [arrows[2], second],
    ] as const) {
      expect(arrow).toMatchObject({ from: from[0]!.id, to: from[2]!.id });
    }
  });

  it("lists the most recently used first, and runs anywhere", async () => {
    const old = await seed("Old", [box("a")]);
    const recent = await seed("Recent", [box("a")]);
    await db()
      .update(schema.diagramComponents)
      .set({ lastUsedAt: toDate("2020-01-01") })
      .where(eq(schema.diagramComponents.id, old.id));
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const r = await run(["diagram", "component", "list"]);

    expect(r.exitCode).toBe(0);
    expect(
      (ndjson(r.stdout) as Array<{ id: string }>).map((c) => c.id)
    ).toEqual([recent.id, old.id]);
  });
});
