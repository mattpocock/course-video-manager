import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import {
  bufferPosts,
  exportedShort,
  fakes,
  jobKinds,
  queue,
  render,
  renders,
  run,
  runSidecarUntilSettled,
  stateOf,
  testDb,
  tickAt,
  uk,
  youtubeInits,
} from "./posting-queue-test-harness";

// ===========================================================================
// Posting Queue failures (#2618): only the failed channel is tried again, at
// the next tick, as a NEW posting Job and only after its read-only post
// check says it did not go out. A post the check cannot place is Held; the
// third failure on a channel marks the entry Failed. The harness runs a real
// Sidecar against HTTP fakes; nothing leaves this machine.
// ===========================================================================

const jobOf = async (kind: string) => {
  const [job] = await testDb
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.kind, kind));
  return job!;
};

/** The claimed posting Jobs, cut off mid-run: the Sidecar died under them. */
const interruptBoth = async () => {
  const startedAt = new Date();
  await testDb
    .update(schema.jobs)
    .set({ status: "interrupted", startedAt, finishedAt: new Date() })
    .where(eq(schema.jobs.status, "queued"));
};

/** A Video Post the cut-off run wrote before it reached the service. */
const unfinishedPost = (videoId: string, platform: string) =>
  testDb.insert(schema.videoPosts).values({ videoId, platform });

const postedOn = async (videoId: string, platform: string) =>
  (
    await testDb
      .select()
      .from(schema.videoPosts)
      .where(
        and(
          eq(schema.videoPosts.videoId, videoId),
          eq(schema.videoPosts.platform, platform)
        )
      )
  ).filter((p) => p.postedAt !== null).length;

describe("Posting Queue failures", () => {
  it("a TikTok failure with YouTube posted retries only Buffer at the next tick, and the entry ends Posted once Buffer succeeds", async () => {
    fakes.bufferRefuses = true;
    const entryId = await queue(
      await exportedShort("Flaky TikTok"),
      uk("08:00"),
      "a0"
    );

    await tickAt(uk("13:00"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect(await stateOf(entryId)).toMatchObject({
      state: "posting",
      youtubeFailures: 0,
      tiktokFailures: 1,
      lastFailureReason: expect.stringContaining("TikTok is busy"),
    });
    expect(await jobKinds()).toEqual(["buffer", "buffer", "youtube-shorts"]);

    fakes.bufferRefuses = false;
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));
    await tickAt(uk("13:06"));

    expect((await stateOf(entryId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(1);
    // The one Buffer refused, then the one it took.
    expect(bufferPosts()).toHaveLength(2);
    expect(await jobKinds()).toEqual(["buffer", "buffer", "youtube-shorts"]);
  });

  it("three failures on a channel mark the entry Failed with the reason; its slot stays used and the next Short claims the next slot", async () => {
    fakes.youtubeUploadFails = 3;
    const failing = await queue(
      await exportedShort("Never uploads"),
      uk("08:00"),
      "a0"
    );
    const next = await queue(await exportedShort("Next up"), uk("08:01"), "a1");

    await tickAt(uk("13:00"));
    for (const at of ["13:02", "13:04", "13:06"]) {
      await runSidecarUntilSettled();
      await tickAt(uk(at));
    }

    expect(await stateOf(failing)).toMatchObject({
      state: "failed",
      youtubeFailures: 3,
      tiktokFailures: 0,
      lastFailureReason: expect.stringContaining("YouTube"),
    });
    expect((await stateOf(failing)).endedAt).not.toBeNull();
    expect(youtubeInits()).toHaveLength(3);
    expect(bufferPosts()).toHaveLength(1);

    await tickAt(uk("18:00"));
    expect((await stateOf(next)).state).toBe("queued");
    await tickAt(uk("13:00", "2026-10-15"));
    expect((await stateOf(next)).claimedSlot?.getTime()).toBe(
      uk("13:00", "2026-10-15")
    );
  });

  it("an interrupted post the check finds is recorded as posted; one it cannot place is Held, never retried, until Matt's Job Retry posts it", async () => {
    const videoId = await exportedShort("Cut off");
    const entryId = await queue(videoId, uk("08:00"), "a0");
    await tickAt(uk("13:00"));
    await interruptBoth();
    await unfinishedPost(videoId, "youtube-shorts");
    await unfinishedPost(videoId, "buffer");
    fakes.youtubeUploads = [{ title: "Cut off", videoId: "yt-live" }];

    await tickAt(uk("13:02"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    expect(await postedOn(videoId, "youtube-shorts")).toBe(1);
    expect(await stateOf(entryId)).toMatchObject({
      state: "held",
      youtubeFailures: 0,
      tiktokFailures: 0,
      lastFailureReason: expect.stringContaining("publish.buffer.com"),
    });
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(0);

    const buffer = await jobOf("buffer");
    const retried = await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.retryJob({ jobId: buffer.id, attempt: buffer.attempt })
      )
    );
    expect(retried.outcome).toBe("queued");
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));

    expect((await stateOf(entryId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a Held Short taken off the queue posts nothing, even on Matt's Job Retry", async () => {
    const videoId = await exportedShort("Pulled");
    await queue(videoId, uk("08:00"), "a0");
    await tickAt(uk("13:00"));
    await interruptBoth();
    await unfinishedPost(videoId, "buffer");
    await tickAt(uk("13:02"));

    await run(
      Effect.flatMap(PostingQueueOperationsService, (q) =>
        q.unqueueShorts({ videoIds: [videoId], now: uk("13:03") })
      )
    );
    const buffer = await jobOf("buffer");
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.retryJob({ jobId: buffer.id, attempt: buffer.attempt })
      )
    );
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    // Neither Matt's retried Buffer post nor the YouTube retry the tick
    // enqueued (its check said not-posted) posts a Short taken off.
    expect((await jobOf("buffer")).status).toBe("failed");
    expect(bufferPosts()).toHaveLength(0);
    expect(youtubeInits()).toHaveLength(0);
  });

  it("a render that fails for good counts once for each waiting channel, then renders and posts again at the next tick", async () => {
    render.fails = true;
    const entryId = await queue(
      await exportedShort("Broken", "none"),
      uk("08:00"),
      "a0"
    );

    await tickAt(uk("13:00"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect(await stateOf(entryId)).toMatchObject({
      state: "posting",
      youtubeFailures: 1,
      tiktokFailures: 1,
      lastFailureReason:
        "Its render failed: Overlay renderer exited with code 1: boom",
    });
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(0);

    render.fails = false;
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    expect((await stateOf(entryId)).state).toBe("posted");
    expect(renders).toBe(4);
    expect(await jobKinds()).toEqual([
      "buffer",
      "buffer",
      "render-vertical",
      "render-vertical",
      "youtube-shorts",
      "youtube-shorts",
    ]);
  });
});
