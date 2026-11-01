import type { Launcher } from "./launcher";
import {
  CHAT_HIGHLIGHT_REFUSALS,
  type ChatHighlightCommand,
  type ChatHighlightEvent,
} from "./chat-highlight-protocol";
import { cardFrameSize, createCardFeed, type CardStamp } from "./card-feed";
import { CARD_CANVAS, createCardServer } from "./card-server";
import { Refusal } from "./refusal";
import type { StreamCard } from "./stream-args";

/**
 * ONE LIVE STREAM'S CHAT HIGHLIGHTS (spec #2445, stories 69–82): the card
 * server that draws each card, the card feed that eases it onto the stream,
 * and the one highlight showing. Started at Go Live, closed when the Live
 * Stream ends.
 *
 * Commands run one at a time, in their own queue (never the service's: a
 * card's still takes about half a second to draw). Each edge is stamped with
 * the frame the card first changes on, and logged in the streamed Recording
 * Session (`chat-highlight-protocol.ts`), which is the answer the app server
 * waits for. A click's time to the picture is logged with it.
 */

/** The streamed Recording Session, as highlights need it. */
type Session = {
  t0Ms: number;
  chatHighlight: (edge: ChatHighlightEvent) => void;
};

export const startChatHighlights = async (o: {
  launch: Launcher;
  /** The recorder's Windows clock. */
  now: () => number;
  /** How long a card's still may take before its click is refused (`CARD_ANSWER_MS`). */
  answerMs: number;
  /** How long the card server may take to be ready (`CARD_START_MS`). */
  startMs: number;
}) => {
  const server = createCardServer({
    launch: o.launch,
    answerMs: o.answerMs,
    startMs: o.startMs,
  });
  // Warmed from Go Live on, while the take arms and the stream starts: its
  // start (Chromium, the cached card bundle, a warm-up card) takes about a
  // second, so even a first click right after going live finds it ready
  // (#2445 review; it used to wait for the stream to be live, ~5 s more).
  server.start();
  const feed = createCardFeed({ now: o.now, still: CARD_CANVAS });
  const card: StreamCard = {
    port: await feed.port(),
    ...cardFrameSize(CARD_CANVAS),
  };
  let session: Session | undefined;
  /** The highlight showing (or entering), by the app server's id. */
  let showing: string | undefined;
  let queue: Promise<void> = Promise.resolve();

  const edge = (stamp: CardStamp) => ({
    atMs: stamp.atMs,
    fileTime: (stamp.atMs - session!.t0Ms) / 1000,
  });

  const show = async (
    c: Extract<ChatHighlightCommand, { type: "show-highlight" }>,
    receivedAtMs: number
  ) => {
    const still = await server.render({ author: c.author, text: c.text });
    if (!session) throw new Refusal(CHAT_HIGHLIGHT_REFUSALS.notLive);
    const { hidden, shown } = feed.show(still);
    const replaced = showing;
    if (replaced && hidden)
      session.chatHighlight({
        type: "chat-highlight-hidden",
        highlightId: replaced,
        ...edge(await hidden),
      });
    showing = undefined;
    const at = edge(await shown);
    showing = c.highlightId;
    session.chatHighlight({
      type: "chat-highlight-shown",
      highlightId: c.highlightId,
      broadcastId: c.broadcastId,
      messageId: c.messageId,
      author: c.author,
      text: c.text,
      ...at,
      receivedAtMs,
    });
    console.log(
      `recorder: Chat Highlight on the picture ${Math.round(at.atMs - receivedAtMs)} ms after its click reached the service`
    );
  };

  const hide = async (highlightId: string) => {
    if (showing !== highlightId)
      throw new Refusal(CHAT_HIGHLIGHT_REFUSALS.notShowing);
    showing = undefined;
    session?.chatHighlight({
      type: "chat-highlight-hidden",
      highlightId,
      ...edge(await feed.hide()),
    });
  };

  return {
    /** The feed the stream reads its card from. */
    card,
    /** A stream process is launching, its picture starting at this file time (s). */
    launching: (startSeconds: number) => feed.launching(startSeconds),
    /** The streamed Recording Session began: frame 0 is its T0. */
    begin: (s: Session) => {
      session = s;
      feed.begin(s.t0Ms);
    },
    /** A Chat Highlight command: done once its edges are logged. */
    command: (c: ChatHighlightCommand): Promise<void> => {
      const receivedAtMs = o.now();
      const run = async () => {
        if (!session || !feed.running())
          throw new Refusal(CHAT_HIGHLIGHT_REFUSALS.notLive);
        if (c.type === "show-highlight") return show(c, receivedAtMs);
        return hide(c.highlightId);
      };
      // A card that could not be drawn, or the Live Stream ending mid-command,
      // fails it: said as a refusal.
      const done = queue.then(run).catch((e: unknown) => {
        if (e instanceof Refusal) throw e;
        if (!session || !feed.running())
          throw new Refusal(CHAT_HIGHLIGHT_REFUSALS.notLive);
        throw new Refusal(
          CHAT_HIGHLIGHT_REFUSALS.unavailable(
            e instanceof Error ? e.message : String(e)
          )
        );
      });
      queue = done.catch(() => {});
      return done;
    },
    close: async () => {
      session = undefined;
      feed.close();
      await server.close();
    },
  };
};

export type ChatHighlights = Awaited<ReturnType<typeof startChatHighlights>>;
