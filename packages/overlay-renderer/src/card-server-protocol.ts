import { z } from "zod";
import { chatHighlightCardSchema } from "./chat-highlight-card";

/**
 * THE CARD SERVER'S LINE PROTOCOL (spec #2445), apart from Remotion: its
 * arguments, and how it answers the lines on its stdin. `card-server.ts`
 * runs it with a real `renderStill`; the recorder service's tests run it
 * with a drawn PNG, against the scripted fake, so the two cannot drift.
 *
 * stdout lines (JSON), and nothing else on stdout:
 *   {"type":"ready","width","height","startMs","warmRenderMs"}   once, first
 *   {"type":"card","id","width","height","renderMs","png":"<base64>"}
 *   {"type":"error","id","message"}   (id is null if the line didn't parse)
 * stdin lines: {"id","author","text"}, or `quit` (as closing stdin: the
 * requests already read are answered, then it ends). Blank lines are
 * ignored. Requests are answered one at a time, in arrival order.
 */

export type CardServerArgs = {
  frameWidth: number;
  /** Bundle the card ahead (`browser:ensure`), then exit. */
  prepare: boolean;
  help: boolean;
};

export const parseCardServerArgs = (argv: readonly string[]) => {
  const args: CardServerArgs = {
    frameWidth: 1920,
    prepare: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--frame-width":
        args.frameWidth = Number(argv[++i]);
        if (!Number.isFinite(args.frameWidth) || args.frameWidth <= 0) {
          throw new Error("--frame-width must be a positive number.");
        }
        break;
      case "--prepare":
        args.prepare = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const requestSchema = chatHighlightCardSchema.extend({ id: z.string() });

export type CardRequest = z.infer<typeof requestSchema>;

/** One line the card server writes on stdout. */
export type CardServerReply =
  | {
      type: "ready";
      width: number;
      height: number;
      startMs: number;
      warmRenderMs: number;
    }
  | {
      type: "card";
      id: string;
      width: number;
      height: number;
      renderMs: number;
      png: string;
    }
  | { type: "error"; id: string | null; message: string };

/**
 * Serves `lines` until `quit` or their end: ready first (with `ready`'s
 * size and timings), then one answer per request, in order. Resolves once
 * the last answer is written.
 */
export const serveCardRequests = async (o: {
  lines: AsyncIterable<string>;
  ready: {
    width: number;
    height: number;
    startMs: number;
    warmRenderMs: number;
  };
  render: (card: { author: string; text: string }) => Promise<Buffer>;
  reply: (line: CardServerReply) => void;
  now: () => number;
}) => {
  o.reply({ type: "ready", ...o.ready });
  for await (const raw of o.lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line === "quit") break;
    let id: string | null = null;
    try {
      const request = requestSchema.parse(JSON.parse(line));
      id = request.id;
      const started = o.now();
      const png = await o.render({
        author: request.author,
        text: request.text,
      });
      o.reply({
        type: "card",
        id,
        width: o.ready.width,
        height: o.ready.height,
        renderMs: Math.round(o.now() - started),
        png: png.toString("base64"),
      });
    } catch (error) {
      o.reply({
        type: "error",
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
