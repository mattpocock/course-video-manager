import { Args, Options } from "@effect/cli";
import { OVERLAY_KINDS } from "@/features/videos/overlay-kind";

/**
 * The kind-agnostic options and arguments of `cvm overlay` — the anchor, the
 * window, the discriminator and the Definition Card's own two content flags,
 * each in its `add` (required) and its `update` (optional) form.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, exactly as `overlay.bullets.ts` holds the Bullet Panel's own flags.
 * The help TEXT an author reads lives in overlay.help.ts; these descriptions
 * are the one-line `--help` summaries `@effect/cli` prints beside each flag.
 */

export const videoOpt = Options.text("video").pipe(
  Options.withDescription("The Video id whose Overlays to list (required).")
);

export const clipFilterOpt = Options.text("clip").pipe(
  Options.withDescription(
    "Narrow the listing to the Overlays anchored to this Clip id."
  ),
  Options.optional
);

export const clipAddOpt = Options.text("clip").pipe(
  Options.withDescription("The anchor Clip id (required).")
);

export const clipUpdateOpt = Options.text("clip").pipe(
  Options.withDescription(
    "Re-anchor the Overlay to this Clip id, which must be in the SAME Video " +
      "(the offset stays Clip-relative)."
  ),
  Options.optional
);

export const atAddOpt = Options.float("at").pipe(
  Options.withDescription(
    "Offset from the anchor Clip's own start, seconds (required, >= 0 and " +
      "less than that Clip's own length)."
  )
);

export const atUpdateOpt = Options.float("at").pipe(
  Options.withDescription(
    "New offset from the anchor Clip's own start, seconds (>= 0 and less " +
      "than the anchor Clip's own length)."
  ),
  Options.optional
);

export const durationAddOpt = Options.float("duration").pipe(
  Options.withDescription(
    "How long the Overlay stays on screen, seconds (required, > 0). Not " +
      "bounded by the anchor Clip's own length."
  )
);

export const durationUpdateOpt = Options.float("duration").pipe(
  Options.withDescription("New on-screen length, seconds (> 0)."),
  Options.optional
);

export const kindOpt = Options.choice("kind", OVERLAY_KINDS).pipe(
  Options.withDescription(
    `Which content-kind the Overlay carries: ${OVERLAY_KINDS.join(
      " | "
    )}. Omitted on 'add' means "definitionCard".`
  ),
  Options.optional
);

export const titleAddOpt = Options.text("title").pipe(
  Options.withDescription(
    "The Definition Card's heading — the term being defined (required)."
  )
);

export const titleUpdateOpt = Options.text("title").pipe(
  Options.withDescription("New Definition Card heading."),
  Options.optional
);

export const descriptionAddOpt = Options.text("description").pipe(
  Options.withDescription(
    "The Definition Card's body — the definition itself. Required for a " +
      "definitionCard Overlay, refused for a bulletPanel (whose content is " +
      "--bullets-json)."
  ),
  Options.optional
);

export const descriptionUpdateOpt = Options.text("description").pipe(
  Options.withDescription("New Definition Card body."),
  Options.optional
);

export const idArg = Args.text({ name: "id" });
export const idsArg = Args.text({ name: "id" }).pipe(Args.repeated);
