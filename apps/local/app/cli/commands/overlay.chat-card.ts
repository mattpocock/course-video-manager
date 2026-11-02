import { Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { notFound, parseError } from "@/cli/helpers";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { resolveVideoFormat } from "@/features/videos/video-format";
import {
  chatHighlightAt,
  chatSpinReel,
  type ChatSpinCell,
} from "@cvm/core/features/videos/chat-card";

/**
 * The Chat Card half of `cvm overlay add`: its two flags, the rule that says
 * which flags go with `--kind chatCard`, and the copy of its Chat Highlight
 * into the Overlay's columns (author into `title`, text into `description`,
 * the Chat Spin's cells into `chatSpin`). Content is copied, never linked.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, as `overlay.b-roll.ts` holds the B-roll's.
 */

export const chatCardOpts = {
  chatHighlight: Options.text("chat-highlight").pipe(
    Options.withDescription(
      "The Chat Highlight id a Chat Card shows. Omitted: the one showing at " +
        "the anchor point of a Streamed Recording Session's Clip, else the " +
        "last one shown before it. Only with --kind chatCard."
    ),
    Options.optional
  ),
  noChatSpin: Options.boolean("no-chat-spin").pipe(
    Options.withDescription(
      "Turn a Chat Card's Chat Spin off: it just eases in. Only with --kind " +
        "chatCard."
    )
  ),
};

export type ChatCardFlags = {
  chatHighlight: Option.Option<string>;
  noChatSpin: boolean;
};

const refuse = (message: string) => parseError(message, "overlay");

/**
 * Which flags go with the kind the Overlay will BE. A Chat Card's content is
 * its Chat Highlight's, so it takes no `--title`, `--description` or
 * `--bullets-json` (and, as every kind but a B-roll, no `--footage`/`--from`).
 * Every other kind refuses the Chat Card's two flags.
 */
export const requireChatCardFlags = (params: {
  kind: OverlayKind;
  title: string | undefined;
  description: string | undefined;
  bulletsJson: string | undefined;
  chatCard: ChatCardFlags;
}) => {
  if (params.kind !== "chatCard") {
    return Option.isSome(params.chatCard.chatHighlight) ||
      params.chatCard.noChatSpin
      ? refuse(
          "--chat-highlight and --no-chat-spin are Chat Card flags; pass " +
            "--kind chatCard to author one"
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
  wasKind: string;
  willBeKind: string;
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

/** Seconds as a refusal spells them. */
const secs = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

/**
 * The Chat Highlight a Chat Card on this anchor shows: `--chat-highlight`'s,
 * else the one at the anchor point of its Streamed Recording Session.
 */
const pickChatHighlight = (params: {
  anchor: {
    id: string;
    recordingSessionId: string | null;
    sourceStartTime: number;
  };
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
      const session = yield* overlayOps.getRecordingSessionChatHighlights(
        pick.recordingSessionId
      );
      return { pick, session: session?.highlights ?? [pick] };
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
        `no Chat Highlight was shown by ${secs(atMs - session.t0Ms)} into ` +
          "this Clip's Recording Session; pass --chat-highlight with one of " +
          `its Chat Highlights: ${listed}`
      );
    }
    return { pick, session: session.highlights };
  });

/**
 * The Chat Card columns this write leaves behind: for every other kind only a
 * null `chatSpin`; for a Chat Card, on a Short only, its Chat Highlight's
 * author and text, and its spin's cells (`[]` with `--no-chat-spin`, or with
 * fewer than two other Chat Highlights in that Recording Session).
 */
export const resolveChatCardColumns = (params: {
  kind: OverlayKind;
  anchor: {
    id: string;
    videoId: string;
    recordingSessionId: string | null;
    sourceStartTime: number;
  };
  at: number;
  flags: ChatCardFlags;
}) =>
  Effect.gen(function* () {
    if (params.kind !== "chatCard") return { chatSpin: null };

    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.anchor.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.anchor.videoId)
        )
      );
    if (resolveVideoFormat(video.format) !== "short") {
      return yield* refuse(
        `Video ${params.anchor.videoId} is not a Short, and a Chat Card is ` +
          "drawn only in a Short"
      );
    }

    const { pick, session } = yield* pickChatHighlight({
      anchor: params.anchor,
      at: params.at,
      chatHighlight: Option.getOrUndefined(params.flags.chatHighlight),
    });
    const chatSpin: ChatSpinCell[] = params.flags.noChatSpin
      ? []
      : chatSpinReel(pick, session);
    return { title: pick.author, description: pick.text, chatSpin };
  });
