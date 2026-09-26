import { describe, expect, it } from "vitest";
import { startPlayingAt, type AnimaticTransport } from "./animatic-transport";

/**
 * The Remotion Player is the system boundary here, so it is the only thing
 * faked. The fake records the ORDER of the calls, because the order is the
 * whole fix: a `seekTo` that arrives while the Player is playing arms
 * Remotion's own resume latch, and an armed latch undoes the author's next
 * click on the pause button.
 */
function fakePlayer(options: { playing: boolean }) {
  const calls: string[] = [];
  let playing = options.playing;
  const player: AnimaticTransport = {
    isPlaying: () => playing,
    pause: () => {
      calls.push("pause");
      playing = false;
    },
    play: () => {
      calls.push("play");
      playing = true;
    },
    seekTo: (frame: number) => {
      calls.push(`seekTo(${frame})`);
    },
  };
  return { player, calls };
}

describe("startPlayingAt", () => {
  it("pauses before it seeks, so the Player never arms its resume latch", () => {
    const { player, calls } = fakePlayer({ playing: true });

    startPlayingAt(player, 120);

    expect(calls).toEqual(["pause", "seekTo(120)", "play"]);
  });

  it("reports itself paused by the time the seek lands", () => {
    const fake = fakePlayer({ playing: true });
    let playingAtSeek: boolean | null = null;
    const watched: AnimaticTransport = {
      ...fake.player,
      seekTo: (frame) => {
        playingAtSeek = fake.player.isPlaying();
        fake.player.seekTo(frame);
      },
    };

    startPlayingAt(watched, 7);

    // Remotion only arms the latch when it is playing as the seek arrives.
    expect(playingAtSeek).toBe(false);
  });

  it("does not pause a Player that is already paused", () => {
    const { player, calls } = fakePlayer({ playing: false });

    startPlayingAt(player, 0);

    expect(calls).toEqual(["seekTo(0)", "play"]);
  });

  it("leaves the Animatic playing", () => {
    const fake = fakePlayer({ playing: true });

    startPlayingAt(fake.player, 42);

    expect(fake.player.isPlaying()).toBe(true);
  });

  it("does nothing at all before the Player has mounted", () => {
    expect(() => startPlayingAt(null, 12)).not.toThrow();
    expect(() => startPlayingAt(undefined, 12)).not.toThrow();
  });
});
