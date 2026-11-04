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
  jobsOf,
  postNow,
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
    await queue(videoId, uk("08:00", "2026-10-13"));

    await tickAt(uk("12:59"));
    expect((await stateOf(videoId)).state).toBe("queued");
    expect(await jobKinds()).toEqual([]);

    await tickAt(uk("13:00"));
    expect(await stateOf(videoId)).toMatchObject({
      state: "posting",
      slot: uk("13:00"),
    });
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));

    expect((await stateOf(videoId)).state).toBe("posted");
    expect(renders, "a fresh export is not rendered again").toBe(0);

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

  it("a Short asked to Post Now posts at the next check, off the slots, and the Short ahead keeps 13:00", async () => {
    const ahead = await exportedShort("Ahead");
    const now = await exportedShort("Now please");
    await queue(ahead, uk("08:00", "2026-10-13"));
    await queue(now, uk("08:01", "2026-10-13"));

    await postNow(now, uk("10:00"));
    await tickAt(uk("10:01"));
    expect(await stateOf(now)).toMatchObject({
      state: "posting",
      slot: uk("10:01"),
    });
    expect((await stateOf(ahead)).state).toBe("queued");

    await runSidecarUntilSettled();
    await tickAt(uk("10:03"));
    expect((await stateOf(now)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(1);
    expect(JSON.parse(bufferPosts()[0]!.body).variables.input.mode).toBe(
      "shareNow"
    );

    await tickAt(uk("13:00"));
    expect(await stateOf(ahead)).toMatchObject({
      state: "posting",
      slot: uk("13:00"),
    });
  });

  it("ticking again, a crash after the claim, and restarting the Sidecar never post either channel twice", async () => {
    const videoId = await exportedShort("Only once");
    await queue(videoId, uk("08:00", "2026-10-13"));

    // The claim commits, then the Sidecar is gone before it runs a Job.
    await tickAt(uk("13:00"));
    await tickAt(uk("13:02"));
    await tickAt(uk("13:04"));
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    // It comes back: the claimed Jobs run once.
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));
    expect((await stateOf(videoId)).state).toBe("posted");

    // Restarted again, and ticked again, later the same day.
    await runSidecarUntilSettled();
    await tickAt(uk("13:08"));
    await tickAt(uk("17:00"));

    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
    expect(youtubeInits()).toHaveLength(1);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a Short already Posted on YouTube, queued again, is posted only to TikTok, and ends Posted", async () => {
    const videoId = await exportedShort("Half out");
    await testDb.insert(schema.videoPosts).values({
      videoId,
      platform: "youtube-shorts",
      remoteId: "yt-old",
      postedAt: new Date(uk("13:00", "2026-10-01")),
    });
    await queue(videoId, uk("08:00", "2026-10-13"));

    await tickAt(uk("13:00"));
    expect(await jobKinds()).toEqual(["buffer"]);
    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));

    expect((await stateOf(videoId)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(0);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a queued Short with no export renders, then posts, at its slot: both posting Jobs wait on the render", async () => {
    const videoId = await exportedShort("Not rendered", "none");
    await queue(videoId, uk("08:00", "2026-10-13"));

    await tickAt(uk("13:00"));
    expect((await stateOf(videoId)).state).toBe("posting");
    const [renderJob] = await jobsOf("render-vertical");
    expect(renderJob!.params).toEqual({ videoId });
    const posts = [
      ...(await jobsOf("youtube-shorts")),
      ...(await jobsOf("buffer")),
    ];
    expect(posts.map((j) => j.dependsOn)).toEqual([
      renderJob!.id,
      renderJob!.id,
    ]);

    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));
    expect((await stateOf(videoId)).state).toBe("posted");
    expect(renders).toBe(1);
    expect(youtubeInits()).toHaveLength(1);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("a Short edited after its render re-renders before posting; one rendered before the Short Export Hash re-renders too", async () => {
    const edited = await exportedShort("Edited");
    const legacy = await exportedShort("Legacy", "legacy");
    await queue(edited, uk("08:00", "2026-10-13"));
    await queue(legacy, uk("08:01", "2026-10-13"));
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
    expect((await stateOf(legacy)).state).toBe("posting");
    await runSidecarUntilSettled();
    expect(renders).toBe(2);
    expect(youtubeInits()).toHaveLength(2);
  });

  it("only the main checkout's Sidecar claims: a linked worktree and a scratch clone never do", async () => {
    const videoId = await exportedShort("Main only");
    await queue(videoId, uk("08:00", "2026-10-13"));
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
      expect((await stateOf(videoId)).state).toBe("queued");
      expect(await jobKinds()).toEqual([]);

      await tickAt(uk("13:00"), postingQueueTickIn(main, noScratch));
      expect((await stateOf(videoId)).state).toBe("posting");
    } finally {
      fs.rmSync(repos, { recursive: true, force: true });
    }
  });
});
