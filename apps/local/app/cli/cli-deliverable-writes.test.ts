import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import * as schema from "@/db/schema";

// ===========================================================================
// cvm WRITE verbs — deliverable create / update / archive
//
// Deliverables are the CVM's only date-of-intent, so these verbs are the
// surface a scheduling agent uses to read and set deadlines.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

interface Deliverable {
  id: string;
  name: string | null;
  title: string;
  date: string;
  status: string;
  notes: string | null;
  archived: boolean;
  courseIds: string[];
  pitchIds: string[];
}
const dobj = (stdout: string): Deliverable => one<Deliverable>(stdout);

let s: WriteSeed;
let courseId: string;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  const rows = await testDb.select().from(schema.courses);
  courseId = rows[0]!.id;
});

describe("deliverable create", () => {
  it("creates a planned deliverable pinned to a date", async () => {
    const { stdout, stderr, exitCode } = await run([
      "deliverable",
      "create",
      "--title",
      "Ship Effect course",
      "--date",
      "2026-08-14",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const d = dobj(stdout);
    expect(d.title).toBe("Ship Effect course");
    expect(d.name).toBe("Ship Effect course");
    expect(d.date).toBe("2026-08-14");
    expect(d.status).toBe("planned");
    expect(d.archived).toBe(false);
    expect(d.courseIds).toEqual([]);
    expect(d.pitchIds).toEqual([]);

    const list = ndjson((await run(["deliverable", "list"])).stdout);
    expect(list.map((x) => (x as Deliverable).id)).toContain(d.id);
  });

  it("accepts --notes, --status and repeated --course / --pitch links", async () => {
    const d = dobj(
      (
        await run([
          "deliverable",
          "create",
          "--title",
          "Launch week",
          "--date",
          "2026-09-01",
          "--notes",
          "two videos + newsletter",
          "--status",
          "done",
          "--course",
          courseId,
          "--pitch",
          s.pitchActiveId,
        ])
      ).stdout
    );
    expect(d.notes).toBe("two videos + newsletter");
    expect(d.status).toBe("done");
    expect(d.courseIds).toEqual([courseId]);
    expect(d.pitchIds).toEqual([s.pitchActiveId]);

    // Links survive the round-trip through the database.
    const fetched = dobj((await run(["deliverable", "get", d.id])).stdout);
    expect(fetched.courseIds).toEqual([courseId]);
    expect(fetched.pitchIds).toEqual([s.pitchActiveId]);
  });

  it("echoes exactly what a following 'get' returns", async () => {
    const created = (
      await run([
        "deliverable",
        "create",
        "--title",
        "Echo",
        "--date",
        "2026-09-03",
        "--course",
        courseId,
      ])
    ).stdout;
    // The echo is a re-read, not a replay of the input: byte-for-byte 'get'.
    const fetched = (await run(["deliverable", "get", dobj(created).id]))
      .stdout;
    expect(created).toBe(fetched);
  });

  it("de-duplicates repeated link ids", async () => {
    const d = dobj(
      (
        await run([
          "deliverable",
          "create",
          "--title",
          "Dupes",
          "--date",
          "2026-09-02",
          "--course",
          courseId,
          "--course",
          courseId,
        ])
      ).stdout
    );
    expect(d.courseIds).toEqual([courseId]);
  });

  it("rejects a missing --title / --date => exit 3", async () => {
    expect(
      (await run(["deliverable", "create", "--date", "2026-01-01"])).exitCode
    ).toBe(3);
    expect(
      (await run(["deliverable", "create", "--title", "x"])).exitCode
    ).toBe(3);
  });

  it("rejects an empty --title => exit 3", async () => {
    const { exitCode, stdout } = await run([
      "deliverable",
      "create",
      "--title",
      "  ",
      "--date",
      "2026-01-01",
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("rejects a malformed or impossible --date => exit 3", async () => {
    for (const date of ["14/08/2026", "2026-8-1", "tomorrow", "2026-02-31"]) {
      const { exitCode, stdout } = await run([
        "deliverable",
        "create",
        "--title",
        "x",
        "--date",
        date,
      ]);
      expect({ date, exitCode }).toEqual({ date, exitCode: 3 });
      expect(stdout).toBe("");
    }
  });

  it("rejects an unknown --status => exit 3", async () => {
    const { exitCode } = await run([
      "deliverable",
      "create",
      "--title",
      "x",
      "--date",
      "2026-01-01",
      "--status",
      "shipped",
    ]);
    expect(exitCode).toBe(3);
  });

  it("rejects an unknown link id => not-found, exit 2, and writes nothing", async () => {
    const { exitCode, stdout } = await run([
      "deliverable",
      "create",
      "--title",
      "x",
      "--date",
      "2026-01-01",
      "--course",
      "nope",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(ndjson((await run(["deliverable", "list"])).stdout)).toEqual([]);
  });

  it("treats an archived pitch as absent => exit 2", async () => {
    const { exitCode } = await run([
      "deliverable",
      "create",
      "--title",
      "x",
      "--date",
      "2026-01-01",
      "--pitch",
      s.pitchArchivedId,
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("deliverable update", () => {
  const seedDeliverable = async () =>
    dobj(
      (
        await run([
          "deliverable",
          "create",
          "--title",
          "Original",
          "--date",
          "2026-08-14",
          "--course",
          courseId,
        ])
      ).stdout
    );

  it("patches only the flags that were passed", async () => {
    const d = await seedDeliverable();
    const updated = dobj(
      (await run(["deliverable", "update", "--date", "2026-08-21", d.id]))
        .stdout
    );
    expect(updated.date).toBe("2026-08-21");
    expect(updated.title).toBe("Original");
    expect(updated.status).toBe("planned");
    expect(updated.courseIds).toEqual([courseId]);
  });

  it("--status moves the deliverable to a terminal status and back again", async () => {
    const d = await seedDeliverable();
    expect(
      dobj(
        (await run(["deliverable", "update", "--status", "done", d.id])).stdout
      ).status
    ).toBe("done");
    expect(
      dobj(
        (await run(["deliverable", "update", "--status", "cancelled", d.id]))
          .stdout
      ).status
    ).toBe("cancelled");
    // Terminal is terminal for Pitch State derivation, not immutable: every
    // transition is reversible (ADR 0007 / CONTEXT.md "Deliverable Status").
    expect(
      dobj(
        (await run(["deliverable", "update", "--status", "planned", d.id]))
          .stdout
      ).status
    ).toBe("planned");
  });

  it("--course / --pitch REPLACE the whole link set", async () => {
    const d = await seedDeliverable();
    const updated = dobj(
      (await run(["deliverable", "update", "--pitch", s.pitchActiveId, d.id]))
        .stdout
    );
    // Untouched noun keeps its links; touched noun is replaced wholesale.
    expect(updated.courseIds).toEqual([courseId]);
    expect(updated.pitchIds).toEqual([s.pitchActiveId]);
  });

  it("--clear-courses empties the course links", async () => {
    const d = await seedDeliverable();
    const updated = dobj(
      (await run(["deliverable", "update", "--clear-courses", d.id])).stdout
    );
    expect(updated.courseIds).toEqual([]);
  });

  it("rejects --course together with --clear-courses => exit 3", async () => {
    const d = await seedDeliverable();
    const { exitCode } = await run([
      "deliverable",
      "update",
      "--course",
      courseId,
      "--clear-courses",
      d.id,
    ]);
    expect(exitCode).toBe(3);
  });

  it("rejects an update with no field flags => exit 3", async () => {
    const d = await seedDeliverable();
    const { exitCode } = await run(["deliverable", "update", d.id]);
    expect(exitCode).toBe(3);
  });

  it("rejects an unknown id => exit 2", async () => {
    const { exitCode } = await run([
      "deliverable",
      "update",
      "--status",
      "done",
      "missing-id",
    ]);
    expect(exitCode).toBe(2);
  });

  it("treats an archived deliverable as absent => exit 2", async () => {
    const d = await seedDeliverable();
    await run(["deliverable", "archive", d.id]);
    const { exitCode } = await run([
      "deliverable",
      "update",
      "--status",
      "done",
      d.id,
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("deliverable archive", () => {
  it("hides the deliverable from list and echoes the archived row", async () => {
    const d = dobj(
      (
        await run([
          "deliverable",
          "create",
          "--title",
          "Gone",
          "--date",
          "2026-08-14",
          "--course",
          courseId,
        ])
      ).stdout
    );
    const { stdout, stderr, exitCode } = await run([
      "deliverable",
      "archive",
      d.id,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const archived = dobj(stdout);
    expect(archived.id).toBe(d.id);
    expect(archived.archived).toBe(true);
    expect(archived.courseIds).toEqual([courseId]);

    expect(ndjson((await run(["deliverable", "list"])).stdout)).toEqual([]);
    expect((await run(["deliverable", "get", d.id])).exitCode).toBe(2);
  });

  it("rejects an unknown id => exit 2", async () => {
    expect((await run(["deliverable", "archive", "missing"])).exitCode).toBe(2);
  });

  it("is not repeatable — an archived deliverable is not addressable", async () => {
    const d = dobj(
      (
        await run([
          "deliverable",
          "create",
          "--title",
          "Gone",
          "--date",
          "2026-08-14",
        ])
      ).stdout
    );
    await run(["deliverable", "archive", d.id]);
    expect((await run(["deliverable", "archive", d.id])).exitCode).toBe(2);
  });
});
