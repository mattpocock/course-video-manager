import { Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { parseError } from "@/cli/helpers";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { chatHighlightAt } from "@cvm/core/features/videos/chat-card";

/**
 * The Chat Card half of `cvm overlay add`: its flag, the rule that says
 * which flags go with `--kind chatCard`, and the copy of its Chat Highlight
 * into the Overlay's columns (author into `title`, text into `description`).
 * Content is copied, never linked.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, as `overlay.bullets.ts` holds the Bullet Panel's.
 */

export const chatCardOpts = {
  chatHighlight: Options.text("chat-highlight").pipe(
    Options.withDescription(
      "The Chat Highlight id a Chat Card shows ('cvm chat-highlight list'). " +
        "Omitted: the one showing at the anchor point of a Streamed " +
        "Recording Session's Clip (the latest shown by then, if not yet " +
        "hidden). Only with --kind chatCard."
    ),
    Options.optional
  ),
};

export type ChatCardFlags = {
  chatHighlight: Option.Option<string>;
};

const refuse = (message: string) => parseError(message, "overlay");

/**
 * Which flags go with the kind the Overlay will BE. A Chat Card's content is
 * its Chat Highlight's, so it takes no `--title`, `--description` or
 * `--bullets-json`.
 * Every other kind refuses the Chat Card's flag.
 */
export const requireChatCardFlags = (params: {
  kind: OverlayKind;
  title: string | undefined;
  description: string | undefined;
  bulletsJson: string | undefined;
  chatCard: ChatCardFlags;
}) => {
  if (params.kind !== "chatCard") {
    return Option.isSome(params.chatCard.chatHighlight)
      ? refuse(
          "--chat-highlight is a Chat Card flag; pass --kind chatCard to " +
            "author one"
        )
      : Effect.void;
  }
  return params.title !== undefined ||
    params.description !== undefined ||
    params.bulletsJson !== undefined
    ? refuse(
        "a chatCard Overlay takes no --title, --description or " +
          "--bullets-json: its author and text are copied from its Chat " +
          "Highlight (--chat-highlight <id>)"
      )
    : Effect.void;
};

/**
 * A Chat Card is made only by `add`, from its Chat Highlight: `update` may
 * move, resize or toggle one, but never turns an Overlay into one or one into
 * another kind, and never edits the content it copied.
 */
export const requireChatCardUnchanged = (p: {
  wasKind: OverlayKind;
  willBeKind: OverlayKind;
  contentEdited: boolean;
}) => {
  const touchesChatCard =
    p.wasKind === "chatCard" || p.willBeKind === "chatCard";
  if (p.wasKind !== p.willBeKind && touchesChatCard) {
    return refuse(
      "an Overlay cannot be turned into or out of a chatCard; delete it and " +
        "'overlay add' the one you want"
    );
  }
  return p.wasKind === "chatCard" && p.contentEdited
    ? refuse(
        "a chatCard's content is copied from its Chat Highlight, so it takes " +
          "no --title, --description or --bullets-json; delete it and add " +
          "another with --chat-highlight <id>"
      )
    : Effect.void;
};

/** The Clip a Chat Card is anchored to, as picking its Chat Highlight needs it. */
type ChatCardAnchor = {
  id: string;
  recordingSessionId: string | null;
  sourceStartTime: number;
};

/** Seconds as a refusal spells them. */
const secs = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

/**
 * The Chat Highlight a Chat Card on this anchor shows: `--chat-highlight`'s,
 * else the one at the anchor point of its Streamed Recording Session.
 */
const pickChatHighlight = (params: {
  anchor: ChatCardAnchor;
  at: number;
  chatHighlight: string | undefined;
}) =>
  Effect.gen(function* () {
    const overlayOps = yield* OverlayOperationsService;
    if (params.chatHighlight !== undefined) {
      const pick = yield* overlayOps.getChatHighlightById(params.chatHighlight);
      if (!pick) {
        return yield* refuse(`no Chat Highlight ${params.chatHighlight}`);
      }
      return pick;
    }

    const sessionId = params.anchor.recordingSessionId;
    const session =
      sessionId === null
        ? undefined
        : yield* overlayOps.getRecordingSessionChatHighlights(sessionId);
    if (!session || session.highlights.length === 0) {
      return yield* refuse(
        `Clip ${params.anchor.id} is not from a Streamed Recording Session ` +
          "with Chat Highlights, so there is none to default to; pass " +
          "--chat-highlight <id>"
      );
    }
    // The anchor point on the recorder's clock: T0 plus its file time.
    const atMs =
      session.t0Ms + (params.anchor.sourceStartTime + params.at) * 1000;
    const pick = chatHighlightAt(session.highlights, atMs);
    if (!pick) {
      const listed = session.highlights
        .map(
          (h) => `${h.id} (${secs(h.shownAtMs - session.t0Ms)}, ${h.author})`
        )
        .join(", ");
      return yield* refuse(
        `no Chat Highlight is showing ${secs(atMs - session.t0Ms)} into ` +
          "this Clip's Recording Session; pass --chat-highlight with one of " +
          `its Chat Highlights ('cvm chat-highlight list'): ${listed}`
      );
    }
    return pick;
  });

/**
 * The Chat Card columns this write leaves behind: none for every other kind;
 * for a Chat Card (`requireShortForKind` has already checked it is on a
 * Short) its Chat Highlight's author and text.
 */
export const resolveChatCardColumns = (params: {
  kind: OverlayKind;
  anchor: ChatCardAnchor & { videoId: string };
  at: number;
  flags: ChatCardFlags;
}) =>
  Effect.gen(function* () {
    if (params.kind !== "chatCard") return {};

    const pick = yield* pickChatHighlight({
      anchor: params.anchor,
      at: params.at,
      chatHighlight: Option.getOrUndefined(params.flags.chatHighlight),
    });
    return { title: pick.author, description: pick.text };
  });
