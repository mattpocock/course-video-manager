import { useCallback, useEffect, useState } from "react";
import { hasLocalStorage } from "@/hooks/use-local-storage";

/**
 * How fast the Animatic plays, and the fact that the choice sticks.
 *
 * TWO TIMES IS THE DEFAULT because of what the playback is for. The lines are
 * synthesised speech the author wrote himself, watched to judge the SHAPE of a
 * Lesson — whether moment 14 is too dense, whether the run is 34 minutes. He
 * does not need to hear every word at the speed a student would. A 34 minute
 * Animatic watched at 1x costs a filming morning.
 *
 * THE CHOICE IS REMEMBERED because the speed is a habit of the watcher, not a
 * property of the Video. Setting it again on every Animatic of a Section would
 * be the same click twenty times.
 *
 * The RUN TIME in the corner is deliberately NOT divided by the rate: it is
 * the length of the filmed Lesson, which is what the author is judging, and
 * not how long this sitting takes.
 */

export const ANIMATIC_PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2, 2.5, 3];

export const DEFAULT_ANIMATIC_PLAYBACK_RATE = 2;

const STORAGE_KEY = "animatic:playbackRate";

/**
 * The rate a stored string stands for. Anything the offered controls cannot
 * show — a hand-edited value, a rate dropped from the list, junk — falls back
 * to the default, because a rate the control does not list reads on screen as
 * a control stuck on the wrong number.
 */
export function parseAnimaticPlaybackRate(raw: string | null): number {
  if (raw === null) return DEFAULT_ANIMATIC_PLAYBACK_RATE;
  const parsed = Number(raw);
  if (!ANIMATIC_PLAYBACK_RATES.includes(parsed)) {
    return DEFAULT_ANIMATIC_PLAYBACK_RATE;
  }
  return parsed;
}

/**
 * Starts at the default and moves to the stored rate in an effect, never
 * during the first render: the page is server-rendered, the server has no
 * storage, and a first client render that disagreed with it would be a
 * hydration mismatch.
 */
export function useAnimaticPlaybackRate(): [number, (rate: number) => void] {
  const [rate, setRate] = useState(DEFAULT_ANIMATIC_PLAYBACK_RATE);

  useEffect(() => {
    if (!hasLocalStorage()) return;
    try {
      setRate(parseAnimaticPlaybackRate(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage blocked; the default holds for this sitting.
    }
  }, []);

  const choose = useCallback((next: number) => {
    setRate(next);
    if (!hasLocalStorage()) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Storage full or blocked; the choice still holds for this sitting.
    }
  }, []);

  return [rate, choose];
}
