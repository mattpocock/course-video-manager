import {
  BookOpen,
  CircleQuestionMark,
  Eye,
  Footprints,
  Gamepad2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BeatKind } from "@cvm/core/features/beats/beat-kinds";

/**
 * The Beat kinds themselves are domain vocabulary and live in `@cvm/core`, so
 * the deployed API can talk about them without pulling in an icon set. They are
 * re-exported here because the whole application already asks this module what
 * a Beat kind is.
 */
export {
  BEAT_KINDS,
  DEFAULT_BEAT_KIND,
  BEAT_KIND_DESCRIPTIONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "@cvm/core/features/beats/beat-kinds";

export const BEAT_KIND_ICONS: Record<BeatKind, LucideIcon> = {
  definition: BookOpen,
  walkthrough: Footprints,
  playthrough: Gamepad2,
  quest: CircleQuestionMark,
  reaction: Eye,
};
