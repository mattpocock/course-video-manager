// THE PLACEHOLDER FLOOR, as a CLI flag.
//
// The domain value is a number or null (see PlaceholderFloor in the course-json
// package): the lowest Lesson Priority band whose unshippable Lessons ship as
// Placeholder Lessons. A flag cannot carry `null`, so the CLI spells the four
// positions as BANDS — `none`, `p1`, `p2`, `p3` — and this module is the one
// place a band is turned into a floor. `cvm course readiness` and
// `cvm course publish` both read it, so the two verbs can never disagree about
// what `--placeholders p2` means — and so does the publish page, which keeps
// the author's chosen band in `localStorage` per Course and sends it down the
// wire. A band is the right thing to store and to send: it is stable, it is
// readable by a human hand-editing it, and it means one thing on both surfaces.

import type { PlaceholderFloor } from "@/packages/course-json";

/** The four spellings a `--placeholders` flag accepts, in floor order. */
export const PLACEHOLDER_FLOOR_BANDS = ["none", "p1", "p2", "p3"] as const;

export type PlaceholderFloorBand = (typeof PLACEHOLDER_FLOOR_BANDS)[number];

/** The band a release announces nothing at — the default, as it is in the UI. */
export const ANNOUNCE_NOTHING_BAND: PlaceholderFloorBand = "none";

/**
 * A band as the domain's floor. `none` is the announce-nothing position, so it
 * is a real answer rather than an absent one: asking for it reports the lists a
 * release would show today.
 */
export const placeholderFloorFromBand = (
  band: PlaceholderFloorBand
): PlaceholderFloor => {
  switch (band) {
    case "none":
      return null;
    case "p1":
      return 1;
    case "p2":
      return 2;
    case "p3":
      return 3;
  }
};
