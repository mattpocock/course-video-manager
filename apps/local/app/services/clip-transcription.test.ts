import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { asc, eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { transcribeAndPersistClips } from "./clip-transcription";

// ===========================================================================
// A Transcription persists BOTH halves of Whisper's result: the Clip's `text`
// and its Transcript Words. This is the seam the editor's transcribe route
// sits on, faked at VideoProcessingService so no Whisper key or ffmpeg binary
// is involved — what is under test is what reaches the database.
// ===========================================================================

let testDb: TestDb;
let clipLayer: Layer.Layer<ClipOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  clipLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

interface FakeTranscript {
  words: Array<{ start: number; end: number; text: string }>;
  segments: Array<{ start: number; end: number; text: string }>;
}

/** What Whisper hands back for one second of speech. */
const spoken = (text: string): FakeTranscript => ({
  words: text
    .split(" ")
    .map((word, i) => ({ start: i, end: i + 1, text: ` ${word}` })),
  segments: [{ start: 0, end: text.split(" ").length, text: ` ${text}` }],
});

/**
 * A VideoProcessingService whose transcription is scripted per source file.
 * A file the script maps to `null` cannot be transcribed — and the real
 * service fails its WHOLE batch when one clip's audio does, which is exactly
 * what this reproduces.
 */
const fakeVideoProcessing = (
  script: Record<string, FakeTranscript | null>
): Layer.Layer<VideoProcessingService> =>
  Layer.succeed(VideoProcessingService, {
    transcribeClips: (
      clips: ReadonlyArray<{ id: string; inputVideo: string }>
    ) =>
      Effect.forEach(
        clips,
        (clip) => {
          const transcript = script[clip.inputVideo];
          return transcript
            ? Effect.succeed({ id: clip.id, ...transcript })
            : Effect.fail(
                new Error(`Failed to extract audio: ${clip.inputVideo}`)
              );
        },
        { concurrency: "unbounded" }
      ),
  } as never);

const seedVideo = async (): Promise<string> => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "standalone.mp4", originalFootagePath: "f.mp4" })
    .returning();
  return video!.id;
};

const seedClip = async (
  videoId: string,
  videoFilename: string,
  order: string
): Promise<string> => {
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId,
      videoFilename,
      sourceStartTime: 0,
      sourceEndTime: 5,
      order,
      archived: false,
      text: "",
    })
    .returning();
  return clip!.id;
};

const transcribe = (
  clipIds: readonly string[],
  script: Record<string, FakeTranscript | null>
) =>
  transcribeAndPersistClips(clipIds).pipe(
    Effect.provide(
      Layer.mergeAll(clipLayer, fakeVideoProcessing(script), NodeContext.layer)
    ),
    Effect.runPromise
  );

const wordsOf = async (clipId: string) =>
  (
    await testDb
      .select()
      .from(schema.clipTranscriptWords)
      .where(eq(schema.clipTranscriptWords.clipId, clipId))
      .orderBy(asc(schema.clipTranscriptWords.start))
  ).map((word) => ({ start: word.start, end: word.end, text: word.text }));

const clipRow = async (clipId: string) =>
  (
    await testDb.select().from(schema.clips).where(eq(schema.clips.id, clipId))
  ).at(0)!;

describe("transcribeAndPersistClips", () => {
  it("writes a clip's word timing alongside its text", async () => {
    const videoId = await seedVideo();
    const clipId = await seedClip(videoId, "take.mp4", "a0");

    await transcribe([clipId], { "take.mp4": spoken("hello there") });

    expect((await clipRow(clipId)).text).toBe(" hello there");
    expect(await wordsOf(clipId)).toEqual([
      { start: 0, end: 1, text: " hello" },
      { start: 1, end: 2, text: " there" },
    ]);
  });

  it("marks a clip transcribed only once its word timing is in", async () => {
    const videoId = await seedVideo();
    const clipId = await seedClip(videoId, "take.mp4", "a0");

    await transcribe([clipId], { "take.mp4": spoken("hello") });

    expect((await clipRow(clipId)).transcribedAt).not.toBeNull();
  });

  it("does not cost the other clips their word timing when one clip's audio fails", async () => {
    // The Video-wide re-transcribe (#1571) is how word timing is backfilled,
    // and a Video routinely holds a Clip whose source file has moved or that
    // has no speech in it at all. One such Clip must not leave every other
    // Clip in the Video without its words.
    const videoId = await seedVideo();
    const goodId = await seedClip(videoId, "take.mp4", "a0");
    const badId = await seedClip(videoId, "moved-away.mp4", "a1");

    await transcribe([goodId, badId], {
      "take.mp4": spoken("still here"),
      "moved-away.mp4": null,
    });

    expect(await wordsOf(goodId)).toEqual([
      { start: 0, end: 1, text: " still" },
      { start: 1, end: 2, text: " here" },
    ]);
    expect(await wordsOf(badId)).toEqual([]);
    expect((await clipRow(badId)).transcribedAt).toBeNull();
  });

  it("answers for every clip it was asked about, so none is left waiting", async () => {
    // The editor clears a Clip's "transcribing" spinner off this answer. A
    // Clip that could not be transcribed comes back exactly as it was — still
    // visibly untranscribed — rather than being left out and spinning forever.
    const videoId = await seedVideo();
    const goodId = await seedClip(videoId, "take.mp4", "a0");
    const badId = await seedClip(videoId, "moved-away.mp4", "a1");

    const answered = await transcribe([goodId, badId], {
      "take.mp4": spoken("still here"),
      "moved-away.mp4": null,
    });

    expect(answered.map((clip) => clip.id).sort()).toEqual(
      [goodId, badId].sort()
    );
    expect(
      answered.find((clip) => clip.id === badId)!.transcribedAt
    ).toBeNull();
  });

  it("fails when not one clip could be transcribed, rather than reporting silent success", async () => {
    const videoId = await seedVideo();
    const clipId = await seedClip(videoId, "moved-away.mp4", "a0");

    await expect(
      transcribe([clipId], { "moved-away.mp4": null })
    ).rejects.toThrow();
  });

  it("does nothing, successfully, when asked for no clips", async () => {
    expect(await transcribe([], {})).toEqual([]);
  });
});
