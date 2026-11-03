import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import {
  bufferPosts,
  exportedShort,
  fakes,
  jobKinds,
  jobsOf,
  postedOn,
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

/** Tuesday 08:00: queued then, a Short takes Wednesday's 13:00. */
const TUESDAY = uk("08:00", "2026-10-13");

const latestJob = async (kind: string) => (await jobsOf(kind)).at(-1)!;

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

const retry = (job: { id: string; attempt: number }) =>
  run(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.retryJob({ jobId: job.id, attempt: job.attempt })
    )
  );

describe("Posting Queue failures", () => {
  it("a TikTok failure, then a cancelled retry, with YouTube posted, retry only Buffer at the next tick, and the entry ends Posted once Buffer succeeds", async () => {
    fakes.bufferRefuses = true;
    const videoId = await exportedShort("Flaky TikTok");
    await queue(videoId, TUESDAY);

    await tickAt(uk("13:00"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect(await stateOf(videoId)).toMatchObject({
      state: "posting",
      lastFailureReason: expect.stringContaining("TikTok is busy"),
    });
    expect(await jobKinds()).toEqual(["buffer", "buffer", "youtube-shorts"]);

    // Matt cancels the retry before it runs: one more failure, not a stall.
    const queuedRetry = await latestJob("buffer");
    const cancelled = await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.requestJobCancel({ jobId: queuedRetry.id, kinds: ["buffer"] })
      )
    );
    expect(cancelled.outcome).toBe("cancelled");
    await tickAt(uk("13:04"));
    expect(await stateOf(videoId)).toMatchObject({
      state: "posting",
      lastFailureReason: "TikTok (Buffer): its post was cancelled",
    });

    fakes.bufferRefuses = false;
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));

    expect((await stateOf(videoId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(1);
    // The one Buffer refused, then the one it took.
    expect(bufferPosts()).toHaveLength(2);
    expect(await jobKinds()).toEqual([
      "buffer",
      "buffer",
      "buffer",
      "youtube-shorts",
    ]);
  });

  it("three failures on a channel mark the entry Failed with the reason; its slot stays used, the next Short claims the next slot, and it stays listed until taken off", async () => {
    fakes.youtubeUploadFails = 3;
    const failing = await exportedShort("Never uploads");
    const next = await exportedShort("Next up");
    await queue(failing, TUESDAY);
    await queue(next, TUESDAY + 60_000);

    await tickAt(uk("13:00"));
    for (const at of ["13:02", "13:04", "13:06"]) {
      await runSidecarUntilSettled();
      await tickAt(uk(at));
    }

    expect(await stateOf(failing)).toMatchObject({
      state: "failed",
      lastFailureReason: expect.stringContaining("YouTube"),
    });
    expect(youtubeInits()).toHaveLength(3);
    expect(bufferPosts()).toHaveLength(1);

    await tickAt(uk("18:00"));
    expect((await stateOf(next)).state).toBe("queued");
    await tickAt(uk("13:00", "2026-10-15"));
    expect((await stateOf(next)).slot).toBe(uk("13:00", "2026-10-15"));

    // Weeks later it is still listed, with its reason.
    await tickAt(uk("12:00", "2026-11-02"));
    expect((await stateOf(failing)).state).toBe("failed");
  });

  it("an upload that went out but whose answer never came back (cut off between upload and remote id) is found under the title it was claimed with, even renamed since, and never uploaded again", async () => {
    fakes.youtubeAnswerLost = 1;
    const videoId = await exportedShort("Lost answer");
    await queue(videoId, TUESDAY);

    await tickAt(uk("13:00"));
    await runSidecarUntilSettled();
    await testDb
      .update(schema.videos)
      .set({ title: "Renamed since" })
      .where(eq(schema.videos.id, videoId));
    await tickAt(uk("13:02"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    expect((await stateOf(videoId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(1);
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
  });

  it("an interrupted post the check finds is recorded as posted; one it cannot place is Held, never retried, until Matt's Job Retry posts it", async () => {
    const videoId = await exportedShort("Cut off");
    await queue(videoId, TUESDAY);
    await tickAt(uk("13:00"));
    await interruptBoth();
    await unfinishedPost(videoId, "youtube-shorts");
    await unfinishedPost(videoId, "buffer");
    fakes.youtubeUploads = [{ title: "Cut off", videoId: "yt-live" }];

    await tickAt(uk("13:02"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    expect(await postedOn(videoId)).toEqual(["youtube-shorts"]);
    expect(await stateOf(videoId)).toMatchObject({
      state: "held",
      lastFailureReason: expect.stringContaining("publish.buffer.com"),
    });
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(0);

    expect((await retry(await latestJob("buffer"))).outcome).toBe("queued");
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));

    expect((await stateOf(videoId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a Held Short taken off the queue posts nothing, even on Matt's Job Retry", async () => {
    const videoId = await exportedShort("Pulled");
    await queue(videoId, TUESDAY);
    await tickAt(uk("13:00"));
    await interruptBoth();
    await unfinishedPost(videoId, "buffer");
    await tickAt(uk("13:02"));

    await run(
      Effect.flatMap(PostingQueueOperationsService, (q) =>
        q.unqueueShorts({ videoIds: [videoId], now: uk("13:03") })
      )
    );
    await retry(await latestJob("buffer"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    // Neither Matt's retried Buffer post nor the YouTube retry the tick
    // enqueued (its check said not-posted) posts a Short taken off.
    expect((await latestJob("buffer")).status).toBe("failed");
    expect(bufferPosts()).toHaveLength(0);
    expect(youtubeInits()).toHaveLength(0);
  });

  it("a render that fails for good counts once for each waiting channel, then renders and posts again at the next tick", async () => {
    render.fails = true;
    const videoId = await exportedShort("Broken", "none");
    await queue(videoId, TUESDAY);

    await tickAt(uk("13:00"));
    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect(await stateOf(videoId)).toMatchObject({
      state: "posting",
      lastFailureReason:
        "Its render failed: Overlay renderer exited with code 1: boom",
    });
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(0);

    render.fails = false;
    await runSidecarUntilSettled();
    await tickAt(uk("13:04"));

    expect((await stateOf(videoId)).state).toBe("posted");
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
