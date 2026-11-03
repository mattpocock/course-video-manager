import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { postingQueueTickIn } from "./posting-queue-tick";
import {
  bufferPosts,
  exportedShort,
  fakeUrl,
  jobKinds,
  queue,
  renders,
  runSidecarUntilSettled,
  s3Puts,
  seen,
  stateOf,
  testDb,
  tickAt,
  uk,
  youtubeInits,
} from "./posting-queue-test-harness";

// ===========================================================================
// The Posting Queue tick (#2614): at a Posting Slot the Sidecar posts the
// head of the Posting Queue to YouTube direct and to TikTok through Buffer,
// rendering it first when its vertical export is stale (#2615). The harness
// runs a real Sidecar against fakes; nothing leaves this machine.
// ===========================================================================

describe("the Posting Queue tick", () => {
  it("at 13:00 UK on a weekday posts the one queued Short once to YouTube (public, no notification) and once to Buffer (shareNow), and the entry ends Posted", async () => {
    const videoId = await exportedShort("Ship it");
    const entryId = await queue(videoId, uk("08:00"), "a0");

    await tickAt(uk("12:59"));
    expect((await stateOf(entryId)).state).toBe("queued");
    expect(await jobKinds()).toEqual([]);

    await tickAt(uk("13:00"));
    const claimed = await stateOf(entryId);
    expect(claimed.state).toBe("posting");
    expect(claimed.claimedSlot?.getTime()).toBe(uk("13:00"));
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));

    const posted = await stateOf(entryId);
    expect(posted.state).toBe("posted");
    expect(posted.endedAt).not.toBeNull();

    expect(youtubeInits()).toHaveLength(1);
    const init = youtubeInits()[0]!;
    expect(new URLSearchParams(init.query).get("notifySubscribers")).toBe(
      "false"
    );
    expect(JSON.parse(init.body)).toMatchObject({
      snippet: { title: "Ship it", description: "All about Ship it" },
      status: { privacyStatus: "public" },
    });
    expect(
      seen.find((r) => r.path === "/token"),
      "the stored grant was refreshed at the fake token URL"
    ).toBeDefined();

    expect(s3Puts().map((r) => r.path)).toEqual([
      `/cvm-bucket/cvm/buffer-posts/${videoId}.mp4`,
    ]);
    expect(bufferPosts()).toHaveLength(1);
    const input = JSON.parse(bufferPosts()[0]!.body).variables.input;
    expect(input).toMatchObject({
      channelId: "tiktok-channel",
      text: "Ship it",
      assets: [
        {
          video: {
            url: `${fakeUrl}/cvm-bucket/cvm/buffer-posts/${videoId}.mp4`,
          },
        },
      ],
    });
    // REGRESSION: a Short's Buffer post must publish at once, never sit in
    // Buffer's own queue (its free plan holds 10, and S3 deletes the file
    // after a day).
    expect(input.mode).toBe("shareNow");
  });

  it("ticking again, a crash after the claim, and restarting the Sidecar never post either channel twice", async () => {
    const videoId = await exportedShort("Only once");
    const entryId = await queue(videoId, uk("08:00"), "a0");

    // The claim commits, then the Sidecar is gone before it runs a Job.
    await tickAt(uk("13:00"));
    await tickAt(uk("13:02"));
    await tickAt(uk("13:04"));
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    // It comes back: the claimed Jobs run once.
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));
    expect((await stateOf(entryId)).state).toBe("posted");

    // Restarted again, and ticked again, later the same day.
    await runSidecarUntilSettled();
    await tickAt(uk("13:08"));
    await tickAt(uk("17:00"));

    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
    expect(youtubeInits()).toHaveLength(1);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("two slots due at once (CVM was off) give one claim per tick, and the second only once the first has settled", async () => {
    // Both were in the queue all Wednesday and nothing was posted, so
    // Thursday catches up: 09:00 and 18:00. CVM comes back at 19:00.
    const first = await queue(await exportedShort("First"), uk("08:00"), "a0");
    const second = await queue(
      await exportedShort("Second"),
      uk("08:01"),
      "a1"
    );
    const thursday = (hhmm: string) => uk(hhmm, "2026-10-15");

    await tickAt(thursday("19:00"));
    await tickAt(thursday("19:02"));
    expect((await stateOf(first)).claimedSlot?.getTime()).toBe(
      thursday("09:00")
    );
    expect((await stateOf(second)).state).toBe("queued");
    expect(await jobKinds()).toHaveLength(2);

    await runSidecarUntilSettled();
    await tickAt(thursday("19:04"));
    expect((await stateOf(first)).state).toBe("posted");
    expect((await stateOf(second)).claimedSlot?.getTime()).toBe(
      thursday("18:00")
    );

    await runSidecarUntilSettled();
    await tickAt(thursday("19:06"));
    expect((await stateOf(second)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(2);
    expect(bufferPosts()).toHaveLength(2);
  });

  it("a queued Short with no export renders, then posts, at its slot: both posting Jobs wait on the render", async () => {
    const videoId = await exportedShort("Not rendered", "none");
    const entryId = await queue(videoId, uk("08:00"), "a0");

    await tickAt(uk("13:00"));
    expect((await stateOf(entryId)).state).toBe("posting");
    const jobs = await testDb.select().from(schema.jobs);
    const renderJob = jobs.find((j) => j.kind === "render-vertical")!;
    expect(renderJob.params).toEqual({ videoId });
    expect(
      jobs.filter((j) => j.kind !== "render-vertical").map((j) => j.dependsOn)
    ).toEqual([renderJob.id, renderJob.id]);

    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect((await stateOf(entryId)).state).toBe("posted");
    expect(renders).toBe(1);
    expect(youtubeInits()).toHaveLength(1);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a Short edited after its render re-renders before posting; one rendered before the Short Export Hash re-renders once", async () => {
    const edited = await exportedShort("Edited");
    const legacy = await exportedShort("Legacy", "legacy");
    await queue(edited, uk("08:00"), "a0");
    const legacyEntry = await queue(legacy, uk("08:01"), "a1");
    // A caption word change: only the vertical render draws it.
    await testDb
      .update(schema.clips)
      .set({ text: "Hello again" })
      .where(eq(schema.clips.videoId, edited));

    // Wednesday 13:00 takes the edited Short; Thursday 13:00 the legacy one.
    await tickAt(uk("13:00"));
    expect(await jobKinds()).toEqual([
      "buffer",
      "render-vertical",
      "youtube-shorts",
    ]);
    await runSidecarUntilSettled();
    await tickAt(uk("13:00", "2026-10-15"));
    expect((await stateOf(legacyEntry)).state).toBe("posting");
    await runSidecarUntilSettled();
    expect(renders).toBe(2);

    // Rendered now, so queued again it posts without a render.
    await testDb
      .update(schema.postingQueueEntries)
      .set({ state: "removed" })
      .where(eq(schema.postingQueueEntries.id, legacyEntry));
    await queue(legacy, uk("14:00", "2026-10-15"), "a2");
    await tickAt(uk("13:00", "2026-10-16"));
    await runSidecarUntilSettled();
    expect(renders).toBe(2);
    expect(youtubeInits()).toHaveLength(3);
  });

  it("only the main checkout's Sidecar claims: a linked worktree and a scratch clone never do", async () => {
    const entryId = await queue(
      await exportedShort("Main only"),
      uk("08:00"),
      "a0"
    );
    const repos = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-checkouts-"));
    const main = path.join(repos, "main");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });
    try {
      fs.mkdirSync(main);
      git(main, "init", "-q");
      git(
        main,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init"
      );
      git(main, "worktree", "add", "-q", path.join(repos, "worktree"));
      const noScratch = { scratchRoots: [] };

      await tickAt(
        uk("13:00"),
        postingQueueTickIn(path.join(repos, "worktree"), noScratch)
      );
      // A clone in the temp directory is an agent's (verify-cvm's) scratch.
      await tickAt(uk("13:00"), postingQueueTickIn(main));
      expect((await stateOf(entryId)).state).toBe("queued");
      expect(await jobKinds()).toEqual([]);

      await tickAt(uk("13:00"), postingQueueTickIn(main, noScratch));
      expect((await stateOf(entryId)).state).toBe("posting");
    } finally {
      fs.rmSync(repos, { recursive: true, force: true });
    }
  });
});
