import { after } from "@/packages/clock";

export const MEMORY_AUTOSAVE_DEBOUNCE_MS = 750;

/**
 * Debounced saver that only writes when the text differs from the last value
 * loaded or saved. Seeded with the loaded value, so opening never writes.
 */
export function createMemoryAutosaver(opts: {
  initial: string;
  save: (memory: string) => void;
  debounceMs?: number;
}) {
  let baseline = opts.initial;
  let cancelTimer: (() => void) | undefined;

  const cancel = () => {
    if (cancelTimer) cancelTimer();
    cancelTimer = undefined;
  };

  return {
    update(text: string) {
      cancel();
      if (text === baseline) return;
      cancelTimer = after(
        opts.debounceMs ?? MEMORY_AUTOSAVE_DEBOUNCE_MS,
        () => {
          cancelTimer = undefined;
          baseline = text;
          opts.save(text);
        }
      );
    },
    cancel,
  };
}
