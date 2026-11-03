import { Effect } from "effect";
import { parseError } from "@/cli/helpers";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { requireShort } from "./overlay.chat-card";

/**
 * The Call to Action half of `cvm overlay add` and `update`: its default
 * words, the rule that keeps it a Call to Action, and the columns it writes.
 * Its words are the Overlay's own `title` (the headline) and `description`
 * (the subline); its refusal of `--bullets-json` is `requireContentForKind`'s
 * and of the Chat Card flags `requireChatCardFlags`'.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, as `overlay.chat-card.ts` holds the Chat Card's.
 */

/** The old AI Hero card's words: what a Call to Action given none says. */
export const CALL_TO_ACTION_DEFAULT_WORDS = {
  title: "AIhero.dev",
  description: "Go from Zero To AI Hero",
} as const;

const refuse = (message: string) => parseError(message, "overlay");

/**
 * `update` may edit a Call to Action's words, anchor, duration and
 * toggles, but never turns an Overlay into one or one into another kind: a
 * Kind switch is a delete and an add, as it is for a Chat Card.
 */
export const requireCallToActionUnchanged = (p: {
  wasKind: OverlayKind;
  willBeKind: OverlayKind;
}) =>
  p.wasKind !== p.willBeKind &&
  (p.wasKind === "callToAction" || p.willBeKind === "callToAction")
    ? refuse(
        "an Overlay cannot be turned into or out of a callToAction; delete " +
          "it and 'overlay add' the one you want"
      )
    : Effect.void;

/**
 * The words a new Call to Action stores, on a Short only. With neither line
 * given it says the old card's words; with one given, the other is empty.
 * Every other kind's words are left as the caller gave them.
 */
export const resolveCallToActionWords = (params: {
  kind: OverlayKind;
  videoId: string;
  title: string | undefined;
  description: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.kind !== "callToAction") return {};
    yield* requireShort(params.videoId, "a Call to Action");
    if (params.title === undefined && params.description === undefined) {
      return { ...CALL_TO_ACTION_DEFAULT_WORDS };
    }
    return {
      title: params.title ?? "",
      description: params.description ?? "",
    };
  });
