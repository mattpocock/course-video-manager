import {
  BookOpen,
  CircleQuestionMark,
  Eye,
  Footprints,
  Gamepad2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * All Segment kinds, in the order they're offered in menus. The single source
 * of truth: {@link SegmentKind}, the Effect schema literal, and every menu
 * derive from this tuple, so adding a kind is a one-line change.
 */
export const SEGMENT_KINDS = [
  "definition",
  "walkthrough",
  "playthrough",
  "quest",
  "reaction",
] as const;

/**
 * A Segment's `kind` — the film-time job it does, drawn from the Mise en Place
 * glossary. See `Segment` in CONTEXT.md and
 * docs/adr/0015-video-level-segment-planning.md.
 */
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/** New Segments default to Definition when a kind isn't otherwise specified. */
export const DEFAULT_SEGMENT_KIND: SegmentKind = "definition";

/**
 * One-line description of the job each kind does, shown alongside the label in
 * the "Add segment" menu so authors can pick the right kind at a glance.
 */
export const SEGMENT_KIND_DESCRIPTIONS: Record<SegmentKind, string> = {
  definition: "Explain a concept, term, or idea",
  walkthrough: "Step through existing code or a process",
  playthrough: "Build something live, start to finish",
  quest: "Set the viewer a challenge to attempt",
  reaction: "React to or review code or content",
};

export const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  definition: "Definition",
  walkthrough: "Walkthrough",
  playthrough: "Playthrough",
  quest: "Quest",
  reaction: "Reaction",
};

export const SEGMENT_KIND_ICONS: Record<SegmentKind, LucideIcon> = {
  definition: BookOpen,
  walkthrough: Footprints,
  playthrough: Gamepad2,
  quest: CircleQuestionMark,
  reaction: Eye,
};
