import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { unlistBroadcast } from "@/services/youtube-live-broadcast-writes";
import { useFakeYouTube, youtube } from "@/test-utils/fake-youtube-live";

/**
 * **Unlist When Ended**'s YouTube calls (#2681), with YouTube faked at the
 * HTTP boundary. No test reaches Google.
 */

const { storeGrant, runWithFakeYouTube } = useFakeYouTube();

const unlist = () => runWithFakeYouTube(Effect.either(unlistBroadcast("b-1")));

/** A video's status as `videos.list` answers it. */
const status = {
  uploadStatus: "processed",
  privacyStatus: "public",
  license: "youtube",
  embeddable: true,
  publicStatsViewable: false,
  selfDeclaredMadeForKids: false,
};

describe("unlistBroadcast", () => {
  it("reads the Broadcast's video status, then sends it back with only privacyStatus changed to unlisted", async () => {
    await storeGrant();
    youtube.videos = [
      { status: 200, body: { items: [{ id: "b-1", status }] } },
    ];
    youtube.calls["PUT /youtube/v3/videos"] = [
      { status: 200, body: { id: "b-1" } },
    ];

    expect((await unlist())._tag).toBe("Right");
    expect(
      youtube.requests.map(({ method, path, body }) => ({ method, path, body }))
    ).toEqual([
      {
        method: "GET",
        path: "/youtube/v3/videos?part=status&id=b-1",
        body: null,
      },
      {
        method: "PUT",
        path: "/youtube/v3/videos?part=status",
        body: { id: "b-1", status: { ...status, privacyStatus: "unlisted" } },
      },
    ]);
  });

  it("fails, and changes nothing, when YouTube has no video for the Broadcast", async () => {
    await storeGrant();
    youtube.videos = [{ status: 200, body: { items: [] } }];

    const answer = await unlist();

    expect(answer._tag === "Left" && answer.left.message).toContain(
      "no video for the Broadcast"
    );
    expect(youtube.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  it("fails with YouTube's word when the update is refused", async () => {
    await storeGrant();
    youtube.videos = [
      { status: 200, body: { items: [{ id: "b-1", status }] } },
    ];
    youtube.calls["PUT /youtube/v3/videos"] = [
      {
        status: 403,
        body: { error: { code: 403, message: "Forbidden", errors: [] } },
      },
    ];

    const answer = await unlist();

    expect(answer._tag === "Left" && answer.left.message).toContain(
      "YouTube answered 403 making the Broadcast Unlisted: Forbidden"
    );
  });

  it("fails as Google not connected, without calling YouTube, when there is no grant", async () => {
    const answer = await unlist();

    expect(answer._tag === "Left" && answer.left.message).toBe(
      "Google is not connected."
    );
    expect(youtube.requests).toEqual([]);
  });
});
