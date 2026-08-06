import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  AUTOFILL_CONCURRENCY,
  AutofillService,
  type AutofillVideoResult,
} from "@/services/autofill-service";
import {
  makeAutofillTestLayer,
  readChapters,
  readVideo,
  seedCourseVersion,
  type LessonSpec,
} from "@/services/autofill-service-test-setup";
import { createFakeTextGeneration } from "@/test-utils/fake-text-generation";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

/** Seed a world and run one Autofill pass over it. */
const runAutofill = async (
  lessons: readonly LessonSpec[],
  opts?: {
    includeTodoLessons?: boolean;
    fake?: ReturnType<typeof createFakeTextGeneration>;
    commitState?: "draft" | "pending" | "published";
  }
) => {
  const seeded = await seedCourseVersion(testDb, lessons, {
    commitState: opts?.commitState,
  });
  const fake = opts?.fake ?? createFakeTextGeneration();
  const started: string[] = [];
  const settled: AutofillVideoResult[] = [];

  const run = () =>
    Effect.gen(function* () {
      const autofill = yield* AutofillService;
      return yield* autofill.autofillCourseVersion({
        versionId: seeded.versionId,
        includeTodoLessons: opts?.includeTodoLessons ?? true,
        onVideoStarted: (candidate) => started.push(candidate.videoId),
        onVideoSettled: (result) => settled.push(result),
      });
    }).pipe(Effect.provide(makeAutofillTestLayer(testDb, fake)));

  const result = await Effect.runPromise(run());
  return { ...seeded, fake, result, started, settled, run };
};

describe("AutofillService — candidate rules", () => {
  it("runs six Videos at a time, from a named constant", () => {
    expect(AUTOFILL_CONCURRENCY).toBe(6);
  });

  it("is not a candidate at all when the Video has no Body", async () => {
    const { videoIds, result } = await runAutofill([
      { path: "01-no-body", videos: [{ body: null, description: null }] },
    ]);

    expect(result.candidates).toHaveLength(0);
    expect(result.results).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["no-body"]);

    const video = await Effect.runPromise(
      readVideo(testDb, videoIds["01-no-body/Explainer"]!)
    );
    expect(video?.description).toBeNull();
    const chapters = await Effect.runPromise(
      readChapters(testDb, videoIds["01-no-body/Explainer"]!)
    );
    expect(chapters).toHaveLength(0);
  });

  it("writes the description but no Chapters when a Clip is untranscribed", async () => {
    const { videoIds, result } = await runAutofill([
      {
        path: "01-partial",
        videos: [
          {
            description: null,
            clips: [{ text: "first" }, { text: "second", transcribed: false }],
          },
        ],
      },
    ]);

    expect(result.candidates[0]?.fields).toEqual(["description"]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "untranscribed-clips",
    ]);

    const videoId = videoIds["01-partial/Explainer"]!;
    const video = await Effect.runPromise(readVideo(testDb, videoId));
    expect(video?.description).toContain("Autofilled description");
    expect(await Effect.runPromise(readChapters(testDb, videoId))).toHaveLength(
      0
    );
  });

  it("never overwrites a description that is already there", async () => {
    const { videoIds, result, fake } = await runAutofill([
      {
        path: "01-written",
        videos: [
          { description: "Mine, hand-written", openingChapter: "Intro" },
        ],
      },
    ]);

    expect(result.candidates).toHaveLength(0);
    expect(fake.attempts.description).toBe(0);
    const video = await Effect.runPromise(
      readVideo(testDb, videoIds["01-written/Explainer"]!)
    );
    expect(video?.description).toBe("Mine, hand-written");
  });

  it("leaves Chapters alone on a Video not raising Missing Chapters", async () => {
    const { videoIds, result, fake } = await runAutofill([
      {
        path: "01-chaptered",
        videos: [{ description: null, openingChapter: "Placed by hand" }],
      },
    ]);

    expect(result.candidates[0]?.fields).toEqual(["description"]);
    expect(fake.attempts.chapters).toBe(0);
    const chapters = await Effect.runPromise(
      readChapters(testDb, videoIds["01-chaptered/Explainer"]!)
    );
    expect(chapters.map((c) => c.name)).toEqual(["Placed by hand"]);
  });

  it("replaces the whole Chapter set on a Video raising Missing Chapters", async () => {
    const { videoIds, result } = await runAutofill([
      {
        path: "01-unchaptered",
        // No Chapter opens this Video, so it raises Missing Chapters and its
        // whole set is replaced.
        videos: [{ description: null, clips: [{ text: "one" }] }],
      },
    ]);

    expect(result.candidates[0]?.fields).toEqual(["description", "chapters"]);
    const videoId = videoIds["01-unchaptered/Explainer"]!;
    const chapters = await Effect.runPromise(readChapters(testDb, videoId));
    expect(chapters.map((c) => c.name)).toEqual(["Autofilled opening"]);
    expect(result.results[0]?.status).toBe("filled");
  });

  it("changes the candidate set with the to-do setting", async () => {
    const lessons: LessonSpec[] = [
      {
        path: "01-done",
        authoringStatus: "done",
        videos: [{ description: null, openingChapter: "Intro" }],
      },
      {
        path: "02-todo",
        authoringStatus: "todo",
        videos: [{ description: null, openingChapter: "Intro" }],
      },
    ];

    const withTodo = await runAutofill(lessons, { includeTodoLessons: true });
    expect(withTodo.result.candidates).toHaveLength(2);

    await truncateAllTables(testDb);
    const withoutTodo = await runAutofill(lessons, {
      includeTodoLessons: false,
    });
    expect(withoutTodo.result.candidates.map((c) => c.videoId)).toEqual([
      withoutTodo.videoIds["01-done/Explainer"],
    ]);
  });

  it("attempts only what is still missing on a second run", async () => {
    const { result, fake, run } = await runAutofill([
      {
        path: "01-first",
        videos: [{ description: null, clips: [{ text: "one" }] }],
      },
      {
        path: "02-second",
        videos: [{ description: "Already there", openingChapter: "Intro" }],
      },
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(fake.attempts).toEqual({ description: 1, chapters: 1 });

    const second = await Effect.runPromise(run());
    expect(second.candidates).toHaveLength(0);
    expect(fake.attempts).toEqual({ description: 1, chapters: 1 });
  });
});

describe("AutofillService — failure isolation", () => {
  it("reports one Video's failure without stopping the others", async () => {
    const fake = createFakeTextGeneration({
      descriptionOutcomes: { "BREAK ME": { kind: "fail" } },
    });
    const { videoIds, result } = await runAutofill(
      [
        {
          path: "01-broken",
          videos: [{ body: "BREAK ME", description: null }],
        },
        { path: "02-fine", videos: [{ description: null }] },
      ],
      { fake }
    );

    const byVideoId = new Map(result.results.map((r) => [r.videoId, r]));
    expect(byVideoId.get(videoIds["01-broken/Explainer"]!)?.status).toBe(
      "failed"
    );
    expect(byVideoId.get(videoIds["02-fine/Explainer"]!)?.status).toBe(
      "filled"
    );

    const broken = await Effect.runPromise(
      readVideo(testDb, videoIds["01-broken/Explainer"]!)
    );
    expect(broken?.description).toBeNull();
  });

  it("retries a rate limit and then succeeds, without consuming the attempt", async () => {
    const fake = createFakeTextGeneration({
      descriptionOutcomes: { "SLOW DOWN": { kind: "rate-limit", until: 1 } },
    });
    const { videoIds, result } = await runAutofill(
      [
        {
          path: "01-throttled",
          videos: [{ body: "SLOW DOWN", description: null }],
        },
      ],
      { fake }
    );

    expect(result.results[0]?.status).toBe("filled");
    // Two calls, one attempt: the refusal that said "later" did not count.
    expect(fake.attempts.description).toBe(2);
    const video = await Effect.runPromise(
      readVideo(testDb, videoIds["01-throttled/Explainer"]!)
    );
    expect(video?.description).toContain("Autofilled description");
  });

  it("consumes the attempt on a refusal that is not retryable", async () => {
    const fake = createFakeTextGeneration({
      descriptionOutcomes: {
        "NO CHANCE": { kind: "fail", message: "invalid request" },
      },
    });
    const { result } = await runAutofill(
      [
        {
          path: "01-refused",
          videos: [{ body: "NO CHANCE", description: null }],
        },
      ],
      { fake }
    );

    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.message).toContain("invalid request");
    expect(fake.attempts.description).toBe(1);
  });

  it("leaves the other field unwritten when one field fails", async () => {
    const fake = createFakeTextGeneration({
      chapterOutcomes: { "CHAPTERS FAIL": { kind: "fail" } },
    });
    const { videoIds, result } = await runAutofill(
      [
        {
          path: "01-half",
          videos: [{ description: null, clips: [{ text: "CHAPTERS FAIL" }] }],
        },
      ],
      { fake }
    );

    expect(result.candidates[0]?.fields).toEqual(["description", "chapters"]);
    expect(result.results[0]?.status).toBe("failed");

    const videoId = videoIds["01-half/Explainer"]!;
    const video = await Effect.runPromise(readVideo(testDb, videoId));
    // The description generated fine — but its Video failed, so nothing landed.
    expect(video?.description).toBeNull();
    expect(await Effect.runPromise(readChapters(testDb, videoId))).toHaveLength(
      0
    );
  });

  it("rejects a beforeClipId naming no Clip of this Video", async () => {
    const fake = createFakeTextGeneration({
      chapterOutcomes: { "INVENT AN ID": { kind: "invalid-clip-id" } },
    });
    const { videoIds, result } = await runAutofill(
      [
        {
          path: "01-invented",
          videos: [
            {
              description: null,
              clips: [{ text: "INVENT AN ID" }],
            },
          ],
        },
      ],
      { fake }
    );

    expect(result.results[0]?.status).toBe("failed");
    const videoId = videoIds["01-invented/Explainer"]!;
    expect(await Effect.runPromise(readChapters(testDb, videoId))).toHaveLength(
      0
    );
    const video = await Effect.runPromise(readVideo(testDb, videoId));
    expect(video?.description).toBeNull();
  });
});

describe("AutofillService — progress and the Draft Version", () => {
  it("reports progress per Video as the run proceeds", async () => {
    const { started, settled, videoIds } = await runAutofill([
      { path: "01-a", videos: [{ description: null, openingChapter: "I" }] },
      { path: "02-b", videos: [{ description: null, openingChapter: "I" }] },
    ]);

    expect(new Set(started)).toEqual(
      new Set([videoIds["01-a/Explainer"], videoIds["02-b/Explainer"]])
    );
    expect(settled.map((r) => r.status)).toEqual(["filled", "filled"]);
  });

  it("refuses to write to anything but the Draft Version", async () => {
    const seeded = await seedCourseVersion(
      testDb,
      [{ path: "01-frozen", videos: [{ description: null }] }],
      { commitState: "published" }
    );
    const fake = createFakeTextGeneration();

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const autofill = yield* AutofillService;
        return yield* autofill.autofillCourseVersion({
          versionId: seeded.versionId,
          includeTodoLessons: true,
        });
      }).pipe(Effect.provide(makeAutofillTestLayer(testDb, fake)))
    );

    expect(exit._tag).toBe("Failure");
    expect(fake.attempts.description).toBe(0);
    const video = await Effect.runPromise(
      readVideo(testDb, seeded.videoIds["01-frozen/Explainer"]!)
    );
    expect(video?.description).toBeNull();
  });
});
