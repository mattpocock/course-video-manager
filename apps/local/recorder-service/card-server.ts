import { lineSplitter, type LaunchedProcess, type Launcher } from "./launcher";
import type { CardStill } from "./card-feed";
import { decodePngRgba } from "./png-rgba";

/**
 * THE CARD SERVER, as the recorder service runs it (spec #2445): the overlay
 * renderer's long-lived Chromium (`packages/overlay-renderer/card-server.mjs`)
 * that answers each Chat Highlight with a still of the card, styled as the
 * Remotion Overlays are. Started at Go Live, quit at End Stream. It lowers its
 * own CPU priority, and it never downloads its browser (that is done once,
 * ahead: `browser:ensure`).
 *
 * It only restarts itself: one that quit is started again by the next card
 * asked of it. Nothing about it can touch the stream or the recording.
 */

/** The stream's frame width: the card scales to it. */
const FRAME_WIDTH = 1920;

/**
 * The card server's canvas at 1920 (`chatHighlightCanvasSize`): the stream is
 * launched with it before the card server is up, so it is known here, and
 * the card server's ready line is checked against it.
 */
export const CARD_CANVAS = { width: 736, height: 344 } as const;

/** How long `quit` gets before it is killed. */
const QUIT_MS = 5_000;

/**
 * How long a card's still may take, from its request (once the card server
 * is ready): about 0.5 s warm, so one this late has stalled. Its click is
 * refused, and the stalled card server is killed and a fresh one warmed, so
 * the next click is drawn. The stream never waits on it either way.
 */
export const CARD_ANSWER_MS = 3_000;

/** Why a click was refused when its still came too late. */
export const cardServerStalled = (ms: number) =>
  `The card server did not draw the card within ${ms / 1000} s; a fresh one is starting.`;

type Reply =
  | { type: "ready"; width: number; height: number; warmRenderMs: number }
  | { type: "card"; id: string; png: string; renderMs: number }
  | { type: "error"; id: string | null; message: string };

export const createCardServer = (o: {
  launch: Launcher;
  /** `CARD_ANSWER_MS` on the rig. */
  answerMs: number;
}) => {
  let running:
    | {
        process: LaunchedProcess;
        ready: Promise<{ width: number; height: number }>;
        answers: Map<string, (reply: Reply) => void>;
      }
    | undefined;
  let asked = 0;

  const start = () => {
    const child = o.launch({
      tool: "card-server",
      args: ["--frame-width", String(FRAME_WIDTH)],
    });
    const answers = new Map<string, (reply: Reply) => void>();
    let failed: ((why: string) => void) | undefined;
    const ready = new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        failed = (why) => reject(new Error(why));
        child.onStdout(
          lineSplitter((line) => {
            let reply: Reply;
            try {
              reply = JSON.parse(line) as Reply;
            } catch {
              return;
            }
            if (reply.type === "ready") {
              console.log(
                `recorder: card server ready (warm card ${reply.warmRenderMs} ms)`
              );
              if (
                reply.width !== CARD_CANVAS.width ||
                reply.height !== CARD_CANVAS.height
              )
                return failed?.(
                  `The card server draws ${reply.width}x${reply.height} cards; the stream expects ${CARD_CANVAS.width}x${CARD_CANVAS.height} (CARD_CANVAS).`
                );
              return resolve({ width: reply.width, height: reply.height });
            }
            if (reply.type === "error" && reply.id === null)
              return failed?.(reply.message);
            if (reply.id !== null) answers.get(reply.id)?.(reply);
          })
        );
      }
    );
    // Its last words, for why it quit.
    let tail: string[] = [];
    child.onStderr(
      lineSplitter((line) => {
        tail = [...tail, line].slice(-6);
      })
    );
    const self = { process: child, ready, answers };
    running = self;
    void ready.catch(() => {});
    void child.exited.then((code) => {
      const why = `The card server quit (exit ${code}): ${tail.join(" ").slice(-400)}`;
      failed?.(why);
      for (const answer of answers.values())
        answer({ type: "error", id: null, message: why });
      if (running !== self) return;
      running = undefined;
      console.error(`recorder: ${why}`);
    });
    return self;
  };

  return {
    /** Starts it now, so the first card is warm by the first click. */
    start: () => void (running ?? start()),
    /** The card's still for this message, decoded. */
    render: async (card: {
      author: string;
      text: string;
    }): Promise<CardStill> => {
      const self = running ?? start();
      await self.ready;
      asked += 1;
      const id = String(asked);
      let overdue: ReturnType<typeof setTimeout> | undefined;
      const reply = await new Promise<Reply | undefined>((resolve) => {
        self.answers.set(id, resolve);
        overdue = setTimeout(() => resolve(undefined), o.answerMs);
        self.process.writeStdin(`${JSON.stringify({ id, ...card })}\n`);
      });
      clearTimeout(overdue);
      self.answers.delete(id);
      if (!reply) {
        console.error(
          `recorder: the card server did not answer within ${o.answerMs} ms; starting a fresh one`
        );
        if (running === self) {
          running = undefined;
          self.process.kill();
          start();
        }
        throw new Error(cardServerStalled(o.answerMs));
      }
      if (reply.type === "error") throw new Error(reply.message);
      if (reply.type !== "card")
        throw new Error("The card server answered no card.");
      return decodePngRgba(Buffer.from(reply.png, "base64"));
    },
    /** Its canvas size, once it is ready. */
    size: () => (running ?? start()).ready,
    /** Quits it (it closes its Chromium); killed if it takes too long. */
    close: async () => {
      const self = running;
      running = undefined;
      if (!self) return;
      self.process.writeStdin("quit\n");
      const timer = setTimeout(() => self.process.kill(), QUIT_MS);
      await self.process.exited;
      clearTimeout(timer);
    },
  };
};
