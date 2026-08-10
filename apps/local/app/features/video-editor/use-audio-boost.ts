import { useEffect, useRef } from "react";

/**
 * Module-scope cache: tracks the permanent element → source binding
 * created by createMediaElementSource. The Web Audio API forbids
 * calling createMediaElementSource on an element that was already
 * connected, so we reuse the existing source on re-mounts.
 * WeakMap lets entries be GC'd when the element is removed from the DOM.
 */
const sourceCache = new WeakMap<
  HTMLMediaElement,
  {
    source: MediaElementAudioSourceNode;
    context: AudioContext;
  }
>();

export { sourceCache as _sourceCacheForTesting };

/**
 * Connects a video element to a Web Audio graph with a GainNode
 * to boost audio volume beyond the native 1.0 maximum.
 *
 * Tolerates React Strict Mode double-invoke by caching the
 * element → source binding in a module-scope WeakMap.
 */
export function useAudioBoost(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  boostDb: number
) {
  const gainNodeRef = useRef<GainNode | null>(null);

  // Set up the audio graph (source → gain → destination)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cached = sourceCache.get(video);

    if (!cached) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(video);
      cached = { source, context };
      sourceCache.set(video, cached);
    }

    const { source, context } = cached;
    const gain = context.createGain();
    gain.gain.value = Math.pow(10, boostDb / 20);

    source.connect(gain);
    gain.connect(context.destination);
    gainNodeRef.current = gain;

    return () => {
      source.disconnect();
      gain.disconnect();
      gainNodeRef.current = null;
    };
  }, [videoRef, boostDb]);
}
