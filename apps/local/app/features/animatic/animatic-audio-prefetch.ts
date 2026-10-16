import { useEffect, useRef } from "react";
import { prefetch } from "remotion";
import type { AnimaticSegment } from "./animatic-timeline";

/**
 * How many Clip Mockups past the playing one have their speech held in memory.
 * Three covers a run of short lines at two times speed; each WAV is a few
 * hundred kilobytes.
 */
export const ANIMATIC_AUDIO_PREFETCH_AHEAD = 3;

/**
 * The speech URLs to hold in memory while `activeIndex` plays: the next few
 * Clip Mockups that have a WAV, and NEVER the playing one. Remotion swaps an
 * `<Audio>`'s source to the in-memory copy the moment it lands, and a swap
 * under a playing line restarts it, so only lines still to come are fetched.
 */
export function animaticAudioToPrefetch(
  segments: readonly AnimaticSegment[],
  activeIndex: number
): string[] {
  return segments
    .slice(activeIndex + 1, activeIndex + 1 + ANIMATIC_AUDIO_PREFETCH_AHEAD)
    .flatMap(({ mockup }) =>
      mockup.audioUrl !== null && !mockup.audioMissing ? [mockup.audioUrl] : []
    );
}

/**
 * Keep the next Clip Mockups' speech fetched ahead of the playhead, so a line
 * never waits on the network when its frame comes up (#2265).
 *
 * The frames already arrive early through `premountFor`, and so does the
 * `<Audio>` — but premounting gives the WAV half a second of TIMELINE, which
 * is a quarter of a second at two times speed, and every request for it is a
 * database lookup on the author's server before a byte comes back. Remotion's
 * own `prefetch` reads the whole file into memory instead, and `<Audio>` plays
 * from that copy without asking the server again.
 *
 * Called from inside the composition (`AnimaticComposition`), which is where
 * the playhead is known without the page re-rendering for it.
 *
 * A bridge to Remotion and nothing else: it holds no React state. The playing
 * line is kept as well as the ones ahead, because freeing it would swap its
 * source back mid-line; everything behind is freed.
 */
export function useAnimaticAudioPrefetch(
  segments: readonly AnimaticSegment[],
  activeIndex: number
): void {
  const held = useRef(new Map<string, { free: () => void }>());

  useEffect(() => {
    const wanted = animaticAudioToPrefetch(segments, activeIndex);
    for (const url of wanted) {
      if (!held.current.has(url)) held.current.set(url, prefetch(url));
    }
    const playing = segments[activeIndex]?.mockup.audioUrl ?? null;
    for (const [url, handle] of held.current) {
      if (url !== playing && !wanted.includes(url)) {
        handle.free();
        held.current.delete(url);
      }
    }
  }, [segments, activeIndex]);

  useEffect(() => {
    const map = held.current;
    return () => {
      for (const handle of map.values()) handle.free();
      map.clear();
    };
  }, []);
}
