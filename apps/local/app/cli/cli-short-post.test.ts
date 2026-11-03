import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Clock, Effect, type Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  addShortToPostingQueue,
  loadPostingQueuePanel,
  previewShortPost,
  saveShortDescription,
} from "@/features/video-posting/shorts-posting-queue.server";
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
  // Effect.fn's spans read the nanos, which the spread above does not carry.
  unsafeCurrentTimeNanos: () => BigInt(NOW) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(NOW) * 1_000_000n),
};

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
/** Runs what the Shorts page runs, on the same layer and clock as `run`. */
let page: <A, E>(
  effect: Effect.Effect<
    A,
    E,
    Layer.Layer.Success<ReturnType<typeof buildWriteLayer>>
  >
) => Promise<A>;
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
  page = (effect) =>
    Effect.runPromise(
      effect.pipe(Effect.withClock(fixedClock), Effect.provide(layer))
    );
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

// ===========================================================================
// cvm short move / cvm short unqueue (#2616): changing the Posting Queue.
// ===========================================================================

/** Shorts queued yesterday in the order given; the head takes today's 13:00. */
const queueOfThree = async () => {
  const ids = [];
  for (const [title, order] of [
    ["One", "a0"],
    ["Two", "a1"],
    ["Three", "a2"],
  ] as const) {
    const id = await short(title);
    await testDb.insert(schema.postingQueueEntries).values({
      videoId: id,
      order,
      queuedAt: new Date("2026-11-02T14:00:00Z"),
    });
    ids.push(id);
  }
  return ids as [string, string, string];
};

/** A Short that claimed today's 09:00 and is being posted (or is Held). */
const inFlight = async (title: string, state: "posting" | "held") => {
  const id = await short(title);
  await testDb.insert(schema.postingQueueEntries).values({
    videoId: id,
    order: "Zz",
    queuedAt: new Date("2026-11-01T14:00:00Z"),
    state,
    claimedSlot: new Date("2026-11-03T09:00:00Z"),
    claimedAt: new Date("2026-11-03T09:00:00Z"),
  });
  return id;
};

const queueOrder = async () => {
  const result = await run(["short", "queue"]);
  return (
    one(result.stdout) as {
      entries: Array<{ title: string; goesOutAt: string }>;
    }
  ).entries.map((e) => `${e.title} ${e.goesOutAt}`);
};

describe("cvm short move", () => {
  it("--top moves a Queued Short to the head, and the queue shows its new slot", async () => {
    const [, , three] = await queueOfThree();

    const result = await run(["short", "move", "--top", three]);

    expect(result.exitCode).toBe(0);
    expect(await queueOrder()).toEqual([
      "Three Tue 2026-11-03 13:00",
      "One Wed 2026-11-04 13:00",
      "Two Thu 2026-11-05 13:00",
    ]);
  });

  it("--before and --after put it next to another Queued Short", async () => {
    const [one_, two, three] = await queueOfThree();

    expect(
      (await run(["short", "move", "--before", two, three])).exitCode
    ).toBe(0);
    expect(await queueOrder()).toEqual([
      "One Tue 2026-11-03 13:00",
      "Three Wed 2026-11-04 13:00",
      "Two Thu 2026-11-05 13:00",
    ]);

    expect((await run(["short", "move", "--after", two, one_])).exitCode).toBe(
      0
    );
    expect(await queueOrder()).toEqual([
      "Three Tue 2026-11-03 13:00",
      "Two Wed 2026-11-04 13:00",
      "One Thu 2026-11-05 13:00",
    ]);
  });

  it("refuses a Short that is Posting or Held, or is not queued, exit 3, and moves nothing", async () => {
    const [one_, two] = await queueOfThree();
    const posting = await inFlight("Going out", "posting");
    const outside = await short("Not queued");
    const before = await queueOrder();

    for (const [argv, refused, reason] of [
      [["--top", posting], posting, "Posting"],
      [["--before", posting, two], posting, "Posting"],
      [["--top", outside], outside, "not in the Posting Queue"],
      [["--after", outside, one_], outside, "not in the Posting Queue"],
      [["--before", one_, one_], one_, "itself"],
    ] as const) {
      const result = await run(["short", "move", ...argv]);
      expect(result.exitCode).toBe(3);
      const error = errorOf(result);
      expect(error._tag).toBe("PostingQueueChangeRefusedError");
      expect(error.refusals).toEqual([
        { videoId: refused, reason: expect.stringContaining(reason) },
      ]);
    }
    expect(await queueOrder()).toEqual(before);
  });

  it("needs exactly one of --top / --before / --after", async () => {
    const [one_, two] = await queueOfThree();
    for (const argv of [[one_], ["--top", "--before", two, one_]]) {
      const result = await run(["short", "move", ...argv]);
      expect(result.exitCode).toBe(3);
      expect(errorOf(result)._tag).toBe("ParseError");
    }
  });

  it("is refused on a Remote Box", async () => {
    const [, two] = await queueOfThree();
    delete process.env[LOCAL_MACHINE_ENV_KEY];
    const result = await run(["short", "move", "--top", two]);
    expect(result.exitCode).toBe(7);
    expect(one<{ _tag: string; command: string }>(result.stderr)).toMatchObject(
      { _tag: "LocalOnlyCommandError", command: "cvm short move" }
    );
  });
});

describe("cvm short unqueue", () => {
  it("takes several Shorts off, Queued, Held and Failed, and the rest move up", async () => {
    const [one_] = await queueOfThree();
    const held = await inFlight("Unsure", "held");
    const failed = await short("Broken");
    await testDb.insert(schema.postingQueueEntries).values({
      videoId: failed,
      order: "Zy",
      queuedAt: new Date("2026-10-31T14:00:00Z"),
      state: "failed",
      claimedSlot: new Date("2026-11-02T13:00:00Z"),
      endedAt: new Date("2026-11-02T13:30:00Z"),
      lastFailureReason: "TikTok refused it",
    });

    const result = await run(["short", "unqueue", one_, held, failed]);

    expect(result.exitCode).toBe(0);
    expect(await queueOrder()).toEqual([
      "Two Tue 2026-11-03 13:00",
      "Three Wed 2026-11-04 13:00",
    ]);
    expect(await queueOrder()).toEqual(
      (
        one(result.stdout) as {
          entries: Array<{ title: string; goesOutAt: string }>;
        }
      ).entries.map((e) => `${e.title} ${e.goesOutAt}`)
    );
  });

  it("a Short taken off can be posted again, to the back of the queue", async () => {
    const [one_] = await queueOfThree();
    await run(["short", "unqueue", one_]);

    const result = await run(["short", "post", one_]);

    expect(result.exitCode).toBe(0);
    expect(await queueOrder()).toEqual([
      "Two Tue 2026-11-03 13:00",
      "Three Wed 2026-11-04 13:00",
      "One Thu 2026-11-05 13:00",
    ]);
  });

  it("refuses a Short that is Posting, or not queued, exit 3, and takes none of the batch off", async () => {
    const [one_] = await queueOfThree();
    const posting = await inFlight("Going out", "posting");
    const outside = await short("Not queued");
    const before = await queueOrder();

    const result = await run(["short", "unqueue", one_, posting, outside]);

    expect(result.exitCode).toBe(3);
    const error = errorOf(result);
    expect(error._tag).toBe("PostingQueueChangeRefusedError");
    expect(error.refusals).toEqual([
      { videoId: posting, reason: expect.stringContaining("Posting") },
      {
        videoId: outside,
        reason: expect.stringContaining("not in the Posting Queue"),
      },
    ]);
    expect(await queueOrder()).toEqual(before);
  });

  it("is refused on a Remote Box, before anything is written", async () => {
    const [one_] = await queueOfThree();
    delete process.env[LOCAL_MACHINE_ENV_KEY];
    const result = await run(["short", "unqueue", one_]);
    expect(result.exitCode).toBe(7);
    expect(one<{ _tag: string; command: string }>(result.stderr)).toMatchObject(
      { _tag: "LocalOnlyCommandError", command: "cvm short unqueue" }
    );
    expect((await entries()).every((e) => e.state === "queued")).toBe(true);
  });
});

// ===========================================================================
// The Shorts page (#2617): its modal and Queue panel go through the same core
// functions as `cvm short post` and `cvm short queue`.
// ===========================================================================

describe("the Shorts page", () => {
  it("the modal's Add to Posting Queue is `cvm short post`: same verdict, same entry", async () => {
    const a = await short("Generics");

    const preview = await page(previewShortPost(a));
    const dryRun = await run(["short", "post", "--dry-run", a]);
    expect(ndjson(dryRun.stdout)).toEqual([preview.verdict]);

    const queued = await page(
      addShortToPostingQueue({
        videoId: a,
        title: "Generics",
        description: "About Generics",
      })
    );
    expect(queued).toEqual(preview.verdict);
    expect(await entries()).toEqual([
      expect.objectContaining({
        videoId: a,
        state: "queued",
        queuedAt: new Date(NOW),
      }),
    ]);
    // No posting Job: the Sidecar's tick posts it at its slot.
    expect(await testDb.select().from(schema.jobs)).toEqual([]);

    // The CLI sees the entry the modal made, and refuses it again.
    const again = await run(["short", "post", a]);
    expect(again.exitCode).toBe(3);
  });

  it("the modal shows the CLI's refusal, and queues nothing", async () => {
    const posted = await short("Old news");
    await testDb.insert(schema.videoPosts).values([
      { videoId: posted, platform: "youtube-shorts", postedAt: new Date() },
      { videoId: posted, platform: "buffer", postedAt: new Date() },
    ]);

    const verdict = await page(
      addShortToPostingQueue({
        videoId: posted,
        title: "Old news",
        description: "About Old news",
      })
    );

    expect(verdict).toMatchObject({
      verdict: "refused",
      reason: expect.stringContaining("already Posted"),
      goesOutAt: null,
    });
    expect(await entries()).toEqual([]);
  });

  it("a description typed in the modal is saved on the Video, where --dry-run sees it", async () => {
    const a = await short("Generics", { description: null });
    const before = await run(["short", "post", "--dry-run", a]);
    expect(ndjson(before.stdout)).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining("no description"),
      }),
    ]);

    await page(
      saveShortDescription({ videoId: a, description: " Learn generics \n" })
    );

    expect((await page(previewShortPost(a))).description).toBe(
      "Learn generics"
    );
    const after = await run(["short", "post", "--dry-run", a]);
    expect(after.exitCode).toBe(0);
    expect(ndjson(after.stdout)).toEqual([
      expect.objectContaining({
        verdict: "queued",
        goesOutAt: "Tue 2026-11-03 13:00",
      }),
    ]);
  });

  it("the Queue panel shows what `cvm short queue` prints", async () => {
    await queuedYesterday("Head");
    const a = await short("Generics");
    await run(["short", "post", a]);

    const panel = await page(loadPostingQueuePanel());
    const cli = await run(["short", "queue"]);

    expect(panel.entries.map((e) => e.goesOutAt)).toEqual([
      "Tue 2026-11-03 13:00",
      "Wed 2026-11-04 13:00",
    ]);
    expect(panel).toEqual(one(cli.stdout));
  });
});
