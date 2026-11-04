import { describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import {
  ready,
  setupGoLiveTests,
  transitions,
  youtube,
} from "./go-live-test-harness";

/**
 * End Stream's **Unlist When Ended** (#2681) end to end, without hardware
 * (`go-live-test-harness.ts`), YouTube faked at the HTTP boundary.
 */

setupGoLiveTests();

const live = async () => {
  const r = await ready();
  expect(Either.isRight(await r.goLive())).toBe(true);
  await vi.waitFor(() =>
    expect(r.heard.map((m) => m.type)).toContain("recording-started")
  );
  return r;
};

const videoCalls = () =>
  youtube.calls.filter((c) => c.includes("/youtube/v3/videos"));

describe("End Stream with Unlist When Ended", () => {
  it("makes the Broadcast Unlisted once it has completed it, changing nothing else on it", async () => {
    const r = await live();

    expect(await r.endStream({ unlistWhenEnded: true })).toEqual(
      Either.right({ status: "unlisted" })
    );

    expect(youtube.calls.slice(-3)).toEqual([
      expect.stringMatching(/liveBroadcasts\/transition\?.*complete/),
      "GET /youtube/v3/videos?part=status&id=office-hours",
      "PUT /youtube/v3/videos?part=status",
    ]);
    expect(youtube.videoUpdates).toEqual([
      {
        id: "office-hours",
        status: { ...youtube.videoStatus, privacyStatus: "unlisted" },
      },
    ]);
  });

  it("still unlists when YouTube refused the transition: auto-stop ends the Broadcast", async () => {
    const r = await live();
    youtube.transitionStatus = 403;

    expect(await r.endStream({ unlistWhenEnded: true })).toEqual(
      Either.right({ status: "unlisted" })
    );
    expect(transitions()).toHaveLength(1);
    expect(youtube.videoUpdates).toHaveLength(1);
  });

  it("reports a failed unlist, and the stream still ends", async () => {
    const r = await live();
    youtube.videoUpdateStatus = 403;

    const answer = await r.endStream({ unlistWhenEnded: true });

    expect(answer).toEqual(
      Either.right({
        status: "failed",
        message: expect.stringContaining(
          "YouTube answered 403 making the Broadcast Unlisted"
        ),
      })
    );
    expect(r.windows.streams[0]!.running).toBe(false);
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-stopped")
    );
  });

  it("makes no videos call without it", async () => {
    const r = await live();

    expect(await r.endStream({ unlistWhenEnded: false })).toEqual(
      Either.right({ status: "not-asked" })
    );
    expect(transitions()).toHaveLength(1);
    expect(videoCalls()).toEqual([]);
  });
});
