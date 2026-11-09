// What `cvm lesson update` writes: only the flags that were passed, because
// `update` is a partial patch. Split out of lesson.ts to keep that file under
// the per-file token budget.
import { Option } from "effect";
import type { AUTHORING_STATUSES } from "@/services/lesson-authoring-status";

// "true" / "false" rather than a bare boolean flag, so the one flag both marks
// and clears it, in the same style as --authoring-status.
export const OPTIONAL_VALUES = ["true", "false"] as const;

type LessonPatch = {
  title?: string;
  description?: string;
  authoringStatus?: (typeof AUTHORING_STATUSES)[number];
  priority?: number;
  optional?: boolean;
};

/** Only the flags that were passed: `update` is a partial patch. */
export const lessonPatch = (flags: {
  title: Option.Option<string>;
  description: Option.Option<string>;
  authoringStatus: Option.Option<(typeof AUTHORING_STATUSES)[number]>;
  priority: Option.Option<number>;
  optional: Option.Option<(typeof OPTIONAL_VALUES)[number]>;
}): LessonPatch => {
  const patch: LessonPatch = {};
  if (Option.isSome(flags.title)) patch.title = flags.title.value;
  if (Option.isSome(flags.description)) {
    patch.description = flags.description.value;
  }
  if (Option.isSome(flags.authoringStatus)) {
    patch.authoringStatus = flags.authoringStatus.value;
  }
  if (Option.isSome(flags.priority)) patch.priority = flags.priority.value;
  if (Option.isSome(flags.optional)) {
    patch.optional = flags.optional.value === "true";
  }
  return patch;
};
