import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { clips } from "@/db/schema";

import {
  setupClipServiceTests,
  clipService,
  testDb,
  start,
} from "./clip-service-test-setup";
import { toDate } from "@/packages/clock";

setupClipServiceTests();

const LONDON = "Europe/London";

/**
 * Films `seconds` of Footage from `file` onto a fresh standalone Video, with
 * the Clip made at `createdAt`.
 */
const film = async (
  file: string,
  createdAt: string,
  seconds: number,
  extra: { videoId?: string; startTime?: number; transcribedAt?: string } = {}
) => {
  const videoId = extra.videoId ?? (await clipService.createVideo("Video")).id;
  const startTime = extra.startTime ?? 0;
  const [clip] = await clipService.appendClips({
    videoId,
    insertionPoint: start,
    items: [],
    clips: [{ inputVideo: file, startTime, endTime: startTime + seconds }],
  });
  await testDb
    .update(clips)
    .set({
      createdAt: toDate(createdAt),
      transcribedAt: extra.transcribedAt ? toDate(extra.transcribedAt) : null,
    })
    .where(eq(clips.id, clip!.id));
  return { clip: clip!, videoId };
};

const stats = (now: string, timeZone = LONDON) =>
  clipService.getFootageStats({ now: toDate(now), timeZone });

describe("ClipService.getFootageStats", () => {
  it("is zero with no Footage", async () => {
    expect(await stats("2026-10-12T09:00:00Z")).toEqual({
      todaySeconds: 0,
      last7DaysSeconds: 0,
      personalBest: null,
      todayClips: 0,
      todayKeptClips: 0,
      last7DaysClips: 0,
      last7DaysKeptClips: 0,
    });
  });

  it("starts today at local midnight and each window on a calendar day", async () => {
    // 10:00 BST on Mon 12 Oct. Local midnight is 23:00 UTC the day before.
    const now = "2026-10-12T09:00:00Z";
    await film("today-first-second.mp4", "2026-10-11T23:00:00Z", 60);
    await film("yesterday-last-second.mp4", "2026-10-11T22:59:59Z", 120);
    // 7D starts at local midnight on Tue 6 Oct.
    await film("7d-first-second.mp4", "2026-10-05T23:00:00Z", 240);
    await film("8d-last-second.mp4", "2026-10-05T22:59:59Z", 480);

    expect(await stats(now)).toMatchObject({
      todaySeconds: 60,
      last7DaysSeconds: 60 + 120 + 240,
      todayClips: 1,
      todayKeptClips: 1,
      last7DaysClips: 3,
      last7DaysKeptClips: 3,
    });
  });

  it("names the personal-best day of the last 365 by its live Footage", async () => {
    // 10:00 BST on Mon 12 Oct; the window opens at local midnight on 13 Oct 2025.
    const now = "2026-10-12T09:00:00Z";
    // Two takes either side of UTC midnight that are both 3 May, London time.
    await film("may-a.mp4", "2026-05-02T23:30:00Z", 600);
    await film("may-b.mp4", "2026-05-03T20:00:00Z", 600);
    // A longer single day, but all of it archived.
    const { clip: cut } = await film("june.mp4", "2026-06-01T10:00:00Z", 1500);
    await clipService.archiveClips([cut.id]);
    await film("today.mp4", "2026-10-12T08:00:00Z", 900);
    // The biggest day of all, one second before the window opens.
    await film("too-old.mp4", "2025-10-12T22:59:59Z", 5000);

    expect((await stats(now)).personalBest).toEqual({
      date: "2026-05-03",
      seconds: 1200,
    });
  });

  it("puts the day start in the given time zone", async () => {
    // 23:30 UTC on 11 Oct is 00:30 on 12 Oct in London (BST).
    await film("after-london-midnight.mp4", "2026-10-11T23:30:00Z", 90);

    expect((await stats("2026-10-12T09:00:00Z", LONDON)).todaySeconds).toBe(90);
    expect((await stats("2026-10-12T09:00:00Z", "UTC")).todaySeconds).toBe(0);
  });

  it("counts calendar days across a clock change, not 24-hour blocks", async () => {
    // Thu 29 Oct (GMT) at noon; the clocks went back on Sun 25 Oct. 7D starts
    // at midnight on Fri 23 Oct, which was BST: 23:00 UTC on the 22nd.
    const now = "2026-10-29T12:00:00Z";
    await film("bst-midnight.mp4", "2026-10-22T23:30:00Z", 30);

    expect((await stats(now)).last7DaysSeconds).toBe(30);
  });

  it("leaves out Clips the cvm CLI created, in every stat", async () => {
    const now = "2026-10-12T09:00:00Z";
    await film("filmed.mp4", "2026-10-12T08:00:00Z", 60);
    // A Clip built by `cvm clip add`, on a day with nothing else filmed, so
    // it would also have been the personal best.
    const { clip } = await film("built.mp4", "2026-10-10T08:00:00Z", 600);
    await testDb
      .update(clips)
      .set({ origin: "cli" })
      .where(eq(clips.id, clip.id));

    expect(await stats(now)).toEqual({
      todaySeconds: 60,
      last7DaysSeconds: 60,
      personalBest: { date: "2026-10-12", seconds: 60 },
      todayClips: 1,
      todayKeptClips: 1,
      last7DaysClips: 1,
      last7DaysKeptClips: 1,
    });
  });

  it("leaves out archived Clips and Effect Clips", async () => {
    const now = "2026-10-12T09:00:00Z";
    const { videoId, clip: live } = await film(
      "take.mp4",
      "2026-10-12T08:00:00Z",
      100
    );
    const { clip: archived } = await film(
      "take.mp4",
      "2026-10-12T08:00:00Z",
      50,
      { videoId, startTime: 100 }
    );
    await clipService.archiveClips([archived.id]);
    const effectClip = await clipService.createEffectClipAtPosition({
      videoId,
      position: "after",
      targetItemId: live.id,
      targetItemType: "clip",
      videoFilename: "/repo/assets/effects/white-noise.mp4",
      sourceStartTime: 0,
      sourceEndTime: 0.5,
      text: "*white noise*",
      scene: "white noise",
      profile: "main-camera",
      pauseType: "none",
    });
    await testDb
      .update(clips)
      .set({ createdAt: toDate("2026-10-12T08:00:00Z") })
      .where(eq(clips.id, effectClip.id));

    expect((await stats(now)).todaySeconds).toBe(100);
  });

  it("dates a copied Clip by its original's transcription and counts it once", async () => {
    const now = "2026-10-12T09:00:00Z";
    // A copy (a Submit's new Draft, a duplicated Course) is a new row made
    // today, carrying its original's transcription time.
    // Filmed 40 days ago, copied today: not filmed today, even after the
    // original row is gone.
    await film("old-take.mp4", "2026-10-12T08:00:00Z", 300, {
      transcribedAt: "2026-09-02T10:05:00Z",
    });
    // Filmed today and copied today: counted once.
    await film("new-take.mp4", "2026-10-12T07:00:00Z", 45, {
      transcribedAt: "2026-10-12T07:01:00Z",
    });
    await film("new-take.mp4", "2026-10-12T08:00:00Z", 45, {
      transcribedAt: "2026-10-12T07:01:00Z",
    });

    expect(await stats(now)).toEqual({
      todaySeconds: 45,
      last7DaysSeconds: 45,
      personalBest: { date: "2026-09-02", seconds: 300 },
      todayClips: 1,
      todayKeptClips: 1,
      last7DaysClips: 1,
      last7DaysKeptClips: 1,
    });
  });

  it("counts each window's efficiency by Clip, archived Clips included", async () => {
    const now = "2026-10-12T09:00:00Z";
    const { videoId } = await film("take.mp4", "2026-10-12T08:00:00Z", 600);
    const short = { videoId, startTime: 600 };
    const { clip: dud1 } = await film(
      "take.mp4",
      "2026-10-12T08:10:00Z",
      5,
      short
    );
    const { clip: dud2 } = await film("take.mp4", "2026-10-12T08:11:00Z", 5, {
      videoId,
      startTime: 605,
    });
    await film("take.mp4", "2026-10-12T08:12:00Z", 5, {
      videoId,
      startTime: 610,
    });
    // Archived yesterday's take: in 7D, not today.
    const { clip: old } = await film("old.mp4", "2026-10-11T12:00:00Z", 5);
    // Kept take from 11 days ago: in neither.
    await film("older.mp4", "2026-10-01T12:00:00Z", 5);
    await clipService.archiveClips([dud1.id, dud2.id, old.id]);

    // Today 2 of 4 Clips kept, though they hold 605 of the 615 seconds.
    expect(await stats(now)).toMatchObject({
      todaySeconds: 605,
      todayClips: 4,
      todayKeptClips: 2,
      last7DaysClips: 5,
      last7DaysKeptClips: 2,
    });
  });

  it("counts efficiency across every Version, keeping only what the Draft keeps", async () => {
    const now = "2026-10-12T09:00:00Z";
    const filmed = toDate("2026-10-12T08:00:00Z");
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Course" })
      .returning();
    const versionVideo = async (commitState: "published" | "draft") => {
      const [version] = await testDb
        .insert(schema.courseVersions)
        .values({ repoId: course!.id, name: commitState, commitState })
        .returning();
      const [section] = await testDb
        .insert(schema.sections)
        .values({ repoVersionId: version!.id, title: "S", order: 1 })
        .returning();
      const [lesson] = await testDb
        .insert(schema.lessons)
        .values({ sectionId: section!.id, title: "L", order: 1 })
        .returning();
      const [video] = await testDb
        .insert(schema.videos)
        .values({ lessonId: lesson!.id, title: "V", originalFootagePath: "/f" })
        .returning();
      return video!.id;
    };
    const takes = (
      videoId: string,
      cuts: ReadonlyArray<readonly [start: number, archived: boolean]>
    ) =>
      testDb.insert(clips).values(
        cuts.map(([start, archived], i) => ({
          videoId,
          videoFilename: "take.mp4",
          sourceStartTime: start,
          sourceEndTime: start + 10,
          order: `a${i}`,
          text: "",
          archived,
          createdAt: filmed,
        }))
      );
    // Submitted with one take cut (only the Published Version holds it, as
    // a Draft made before Submit carried archived Clips), then in the new
    // Draft the first take was cut too.
    await takes(await versionVideo("published"), [
      [0, false],
      [10, true],
      [20, false],
    ]);
    await takes(await versionVideo("draft"), [
      [0, true],
      [20, false],
    ]);

    expect(await stats(now)).toMatchObject({
      todaySeconds: 10,
      todayClips: 3,
      todayKeptClips: 1,
    });
  });
});
