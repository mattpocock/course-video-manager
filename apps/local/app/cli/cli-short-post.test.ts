import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Clock, Effect } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  ndjson,
  one,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm short post / cvm short queue (#2613): adding Shorts to the Posting
// Queue, and seeing when each goes out. The full CLI stack over a real
// database, on a FIXED clock: Tuesday 2026-11-03 08:00 UK (GMT), so the
// projected slots are known instants. Nothing is posted anywhere.
// ===========================================================================

const NOW = new Date("2026-11-03T08:00:00Z").getTime();

const fixedClock: Clock.Clock = {
  ...Clock.make(),
  unsafeCurrentTimeMillis: () => NOW,
  currentTimeMillis: Effect.succeed(NOW),
};

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
const previousMarker = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const layer = buildWriteLayer(testDb);
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(
        Effect.withClock(fixedClock),
        Effect.provide(out.layer),
        Effect.provide(layer)
      )
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
});

afterAll(() => {
  if (previousMarker === undefined) delete process.env[LOCAL_MACHINE_ENV_KEY];
  else process.env[LOCAL_MACHINE_ENV_KEY] = previousMarker;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

const short = async (
  title: string,
  over: Partial<typeof schema.videos.$inferInsert> = {}
) => {
  const [v] = await testDb
    .insert(schema.videos)
    .values({
      title,
      originalFootagePath: "f.mp4",
      format: "short",
      description: `About ${title}`,
      ...over,
    })
    .returning();
  return v!.id;
};

/** A Short queued yesterday after its 13:00, so it takes today's slot. */
const queuedYesterday = async (title: string) => {
  const id = await short(title);
  await testDb.insert(schema.postingQueueEntries).values({
    videoId: id,
    order: "a0",
    queuedAt: new Date("2026-11-02T14:00:00Z"),
  });
  return id;
};

const entries = () => testDb.select().from(schema.postingQueueEntries);

const errorOf = (result: RunResult) =>
  JSON.parse(result.stderr) as {
    _tag: string;
    refusals?: Array<{ videoId: string; reason: string }>;
  };

describe("cvm short post", () => {
  it("queues several Shorts in the order given and says when each goes out", async () => {
    const head = await queuedYesterday("Head");
    const a = await short("Generics");
    const b = await short("Satisfies");

    const result = await run(["short", "post", a, b]);

    expect(result.exitCode).toBe(0);
    // Today's one slot, 13:00, is Head's; then one a day.
    expect(ndjson(result.stdout)).toEqual([
      {
        videoId: a,
        title: "Generics",
        verdict: "queued",
        reason: null,
        slot: "2026-11-04T13:00:00.000Z",
        goesOutAt: "Wed 2026-11-04 13:00",
      },
      {
        videoId: b,
        title: "Satisfies",
        verdict: "queued",
        reason: null,
        slot: "2026-11-05T13:00:00.000Z",
        goesOutAt: "Thu 2026-11-05 13:00",
      },
    ]);
    const rows = await entries();
    expect(rows.map((r) => r.videoId).sort()).toEqual([head, a, b].sort());
    expect(rows.every((r) => r.state === "queued")).toBe(true);
  });

  it("--dry-run prints each verdict and writes nothing", async () => {
    const a = await short("Generics");
    const landscape = await short("Long one", { format: "landscape" });

    const result = await run(["short", "post", "--dry-run", a, landscape]);

    // Once a day minimum: an empty queue at 00:00 still has today's 13:00.
    expect(ndjson(result.stdout)).toEqual([
      expect.objectContaining({
        videoId: a,
        verdict: "queued",
        goesOutAt: "Tue 2026-11-03 13:00",
      }),
      expect.objectContaining({
        videoId: landscape,
        verdict: "refused",
        reason: expect.stringContaining("Landscape Video"),
        slot: null,
      }),
    ]);
    // The same exit code the real run would give.
    expect(result.exitCode).toBe(3);
    expect(await entries()).toEqual([]);
  });

  it("--dry-run of Shorts that would all be queued exits 0", async () => {
    const a = await short("Generics");
    const result = await run(["short", "post", "--dry-run", a]);
    expect(result.exitCode).toBe(0);
    expect(await entries()).toEqual([]);
  });

  it("refuses each bad Short with its reason, exit 3, and queues none of the batch", async () => {
    const good = await short("Generics");
    const landscape = await short("Long one", { format: "landscape" });
    const untitled = await short("Short 11/3/2026");
    const noDescription = await short("Quiet", { description: "  " });
    const alreadyQueued = await queuedYesterday("Head");
    const posted = await short("Old news");
    await testDb.insert(schema.videoPosts).values([
      { videoId: posted, platform: "youtube-shorts", postedAt: new Date() },
      { videoId: posted, platform: "buffer", postedAt: new Date() },
    ]);

    const result = await run([
      "short",
      "post",
      good,
      landscape,
      untitled,
      noDescription,
      alreadyQueued,
      posted,
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    const error = errorOf(result);
    expect(error._tag).toBe("ShortPostRefusedError");
    expect(error.refusals).toEqual([
      { videoId: landscape, reason: expect.stringContaining("Landscape") },
      { videoId: untitled, reason: expect.stringContaining("default title") },
      {
        videoId: noDescription,
        reason: expect.stringContaining("no description"),
      },
      {
        videoId: alreadyQueued,
        reason: expect.stringContaining("already in the Posting Queue"),
      },
      { videoId: posted, reason: expect.stringContaining("already Posted") },
    ]);
    expect((await entries()).map((e) => e.videoId)).toEqual([alreadyQueued]);
  });

  it("queues a Short Posted on only one channel", async () => {
    const half = await short("Half");
    await testDb
      .insert(schema.videoPosts)
      .values({ videoId: half, platform: "buffer", postedAt: new Date() });
    const result = await run(["short", "post", half]);
    expect(result.exitCode).toBe(0);
  });

  it("is refused on a Remote Box, before anything is written", async () => {
    const a = await short("Generics");
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const result = await run(["short", "post", a]);

    expect(result.exitCode).toBe(7);
    expect(one<{ _tag: string; command: string }>(result.stderr)).toMatchObject(
      { _tag: "LocalOnlyCommandError", command: "cvm short post" }
    );
    expect(await entries()).toEqual([]);
  });
});

describe("cvm short queue", () => {
  it("lists the queue oldest first, with when each goes out and the days it covers", async () => {
    const head = await queuedYesterday("Head");
    const a = await short("Generics");
    const b = await short("Satisfies");
    await run(["short", "post", a]);
    await run(["short", "post", b]);

    const result = await run(["short", "queue"]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toEqual({
      days: 3,
      entries: [
        expect.objectContaining({
          videoId: head,
          title: "Head",
          state: "queued",
          goesOutAt: "Tue 2026-11-03 13:00",
        }),
        expect.objectContaining({
          videoId: a,
          state: "queued",
          goesOutAt: "Wed 2026-11-04 13:00",
        }),
        expect.objectContaining({
          videoId: b,
          state: "queued",
          goesOutAt: "Thu 2026-11-05 13:00",
        }),
      ],
    });
  });

  it("an empty Posting Queue covers no days", async () => {
    const result = await run(["short", "queue"]);
    expect(one(result.stdout)).toEqual({ days: 0, entries: [] });
  });
});
