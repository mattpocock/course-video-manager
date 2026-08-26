import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipOperationsService } from "./db-clip-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

// ===========================================================================
// `anyClipsMissingTranscriptWords` — the flag behind the editor's "Missing
// word timing" alert. It has to answer for the Clips a Transcription can
// actually give words to, because the alert's whole job is to tell the author
// there is a re-transcribe worth running.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<ClipOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, ClipOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

const seedVideo = async (): Promise<string> => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "standalone.mp4", originalFootagePath: "f.mp4" })
    .returning();
  return video!.id;
};

let order = 0;
const seedClip = async (
  videoId: string,
  opts: {
    words?: Array<{ start: number; end: number; text: string }>;
    scene?: string;
    archived?: boolean;
  } = {}
): Promise<string> => {
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: `a${order++}`,
      archived: opts.archived ?? false,
      text: "hello there",
      scene: opts.scene ?? null,
    })
    .returning();

  if (opts.words?.length) {
    await testDb
      .insert(schema.clipTranscriptWords)
      .values(opts.words.map((word) => ({ clipId: clip!.id, ...word })));
  }

  return clip!.id;
};

const SOME_WORDS = [{ start: 0, end: 1, text: "hello" }];

const anyMissing = (videoId: string) =>
  run(
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.anyClipsMissingTranscriptWords(videoId);
    })
  );

describe("anyClipsMissingTranscriptWords", () => {
  it("is false for a video whose clips all carry their word timing", async () => {
    const videoId = await seedVideo();
    await seedClip(videoId, { words: SOME_WORDS });
    await seedClip(videoId, { words: SOME_WORDS });

    expect(await anyMissing(videoId)).toBe(false);
  });

  it("is true when a clip was transcribed without word timing", async () => {
    const videoId = await seedVideo();
    await seedClip(videoId, { words: SOME_WORDS });
    await seedClip(videoId);

    expect(await anyMissing(videoId)).toBe(true);
  });

  it("ignores an archived clip, which is treated as deleted", async () => {
    const videoId = await seedVideo();
    await seedClip(videoId, { words: SOME_WORDS });
    await seedClip(videoId, { archived: true });

    expect(await anyMissing(videoId)).toBe(false);
  });

  it("ignores an Effect Clip, which is white noise and has no words to miss", async () => {
    // An Effect Clip is hand-inserted non-speech (CONTEXT.md, "Effect Clip").
    // No transcription will ever give it a Transcript Word, so counting it
    // leaves the alert lit forever on any Video holding one — telling the
    // author the word timing never landed when it landed everywhere it could.
    const videoId = await seedVideo();
    await seedClip(videoId, { words: SOME_WORDS });
    await seedClip(videoId, { scene: "white noise" });

    expect(await anyMissing(videoId)).toBe(false);
  });

  it("is false for a video with no clips at all", async () => {
    expect(await anyMissing(await seedVideo())).toBe(false);
  });
});
