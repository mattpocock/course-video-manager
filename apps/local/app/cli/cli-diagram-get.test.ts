import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Scene } from "@cvm/core/lib/simple-diagram/index";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { failureOf, ndjson, useDiagramCli } from "./cli-write-test-harness";
import { toDate } from "@/packages/clock";

// ===========================================================================
// cvm diagram get: READ the head and the snapshot list in the simple format.
// Diagrams are made with the real `create` (browser faked, as in
// cli-diagram-snapshot.test.ts), so the round trip is create -> get.
// ===========================================================================

const { db, run, file } = useDiagramCli();

const STEP_1 = [
  { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
  { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
  { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
  { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
  { type: "line", id: "rule", x1: 0, y1: 200, x2: 600, y2: 200 },
  { type: "icon", id: "bot", x: 76, y: -70, name: "bot", color: "blue" },
];
const STEP_2 = [
  ...STEP_1,
  { type: "box", id: "memory", x: 800, y: 0, w: 200, h: 100, fill: "semi" },
];

type Created = { id: string; url: string; snapshots: Array<{ id: string }> };
type Got = {
  id: string;
  name: string;
  url: string;
  head: { shapes: unknown[] };
  snapshots: Array<{
    id: string;
    preserved: boolean;
    clipIds: string[];
    diagramText: string;
    createdAt: string;
  }>;
};

const create = async () => {
  const r = await run([
    "diagram",
    "create",
    "--file",
    file({
      name: "Agent loop",
      snapshots: [{ shapes: STEP_1 }, { shapes: STEP_2 }],
    }),
  ]);
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout)[0] as Created;
};

const writes = async () => ({
  diagrams: await db().query.diagrams.findMany(),
  snapshots: await db().query.diagramSnapshots.findMany(),
});

/** A clip on a fresh video, pinning `snapshotId`. */
const pin = async (snapshotId: string, archived = false) => {
  const [video] = await db()
    .insert(schema.videos)
    .values({ title: "v.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [clip] = await db()
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "0001",
      text: "hello",
      archived,
      diagramSnapshotId: snapshotId,
    })
    .returning();
  return clip!.id;
};

describe("cvm diagram get", () => {
  it("round-trips create: the head and each snapshot read back as the shapes given", async () => {
    const created = await create();
    const clipId = await pin(created.snapshots[1]!.id);
    await pin(created.snapshots[1]!.id, true);
    const before = await writes();

    const r = await run(["diagram", "get", created.id]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [got, ...rest] = ndjson(r.stdout) as Got[];
    expect(rest).toEqual([]);
    expect(got!.id).toBe(created.id);
    expect(got!.name).toBe("Agent loop");
    expect(got!.url).toBe(created.url);
    expect(got!.head).toEqual({ shapes: STEP_1 });
    expect(got!.snapshots.map(({ createdAt: _, ...s }) => s)).toEqual([
      {
        id: created.snapshots[0]!.id,
        preserved: true,
        clipIds: [],
        diagramText: expect.stringContaining("Agent"),
      },
      {
        id: created.snapshots[1]!.id,
        preserved: true,
        clipIds: [clipId],
        diagramText: expect.stringContaining("call"),
      },
    ]);
    expect(Number.isNaN(toDate(got!.snapshots[0]!.createdAt).getTime())).toBe(
      false
    );

    const second = await run([
      "diagram",
      "get",
      "--snapshot",
      created.snapshots[1]!.id,
      created.id,
    ]);
    expect(second.exitCode).toBe(0);
    expect(ndjson(second.stdout)).toEqual([
      { snapshotId: created.snapshots[1]!.id, shapes: STEP_2 },
    ]);

    expect(await writes()).toEqual(before);
  });

  it("reads a hand-drawn shape in the head as `other`", async () => {
    const created = await create();
    const row = await db().query.diagrams.findFirst({
      where: (d, { eq }) => eq(d.id, created.id),
    });
    const scene = row!.headScene as Scene;
    const label = scene.store["shape:label"] as Record<string, unknown>;
    await db()
      .update(schema.diagrams)
      .set({
        headScene: {
          ...scene,
          store: {
            ...scene.store,
            "shape:scribble": {
              ...label,
              id: "shape:scribble",
              type: "draw",
              index: "a9",
              props: { segments: [], color: "black" },
            },
          },
        },
      })
      .where(eq(schema.diagrams.id, created.id));

    const r = await run(["diagram", "get", created.url]);

    expect(r.exitCode).toBe(0);
    expect((ndjson(r.stdout)[0] as Got).head.shapes).toEqual([
      ...STEP_1,
      { type: "other", id: "scribble" },
    ]);
  });

  it("is NotFoundError, exit 2, for a missing Diagram or another Diagram's snapshot", async () => {
    const a = await create();
    const b = await create();

    const missing = await run([
      "diagram",
      "get",
      "00000000-0000-0000-0000-000000000000",
    ]);
    const foreign = await run([
      "diagram",
      "get",
      "--snapshot",
      b.snapshots[0]!.id,
      a.id,
    ]);

    for (const r of [missing, foreign]) {
      expect(r.exitCode).toBe(2);
      expect(failureOf(r)._tag).toBe("NotFoundError");
    }
  });

  it("is not local-only: it only reads", async () => {
    const created = await create();
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const r = await run(["diagram", "get", created.id]);

    expect(r.exitCode).toBe(0);
  });
});
