import {
  readStored,
  removeStoredByPrefix,
  writeStored,
} from "@/hooks/use-local-storage";

/**
 * Local storage keys whose data moved to the database, removed once per
 * browser so the space they took is free again for the keys that stay. The
 * data is not imported: the database starts empty for them.
 */
const RETIRED_KEYS: ReadonlyArray<{ prefixes: string[]; doneKey: string }> = [
  // The YouTube page's title and description: the Video's YouTube Draft now.
  {
    prefixes: ["post-title-", "post-description-"],
    doneKey: "retired-post-drafts-removed",
  },
];

/** Safe to call on every load: each removal runs once, then no-ops. */
export const removeRetiredStorage = (): void => {
  for (const { prefixes, doneKey } of RETIRED_KEYS) {
    if (readStored(doneKey)) continue;
    try {
      removeStoredByPrefix(prefixes);
    } catch (error) {
      // Storage blocked: the next load tries again.
      console.error("Failed to remove retired local storage keys:", error);
      continue;
    }
    writeStored(doneKey, "1");
  }
};
