import { describe, expect, it } from "vitest";
import {
  parseCardServerArgs,
  serveCardRequests,
  type CardServerReply,
} from "@cvm/overlay-renderer/card-server-protocol";
import type { LaunchedProcess } from "./launcher";
import { CARD_CANVAS, createCardServer } from "./card-server";
import { decodePngRgba } from "./png-rgba";
import { fakeWindows } from "./test-utils/fake-windows";
import { cardPng } from "./test-utils/fake-card-server";

/**
 * THE CARD SERVER'S EDGES (spec #2445): the overlay renderer's line protocol
 * and arguments, the PNG decoding the service does on each still, and one
 * contract that the scripted fake speaks the protocol as the real one does.
 */

/** A 5x4 straight-RGBA picture, with every alpha from 0 to 255. */
const PIXELS = Buffer.from(
  "AAD/AD0N2oB6GrX/tyeQTfQ0a8gRYfSATm7P/4t7qk3IiIXIBZVgACLC6f9fz8RNnNyfyNnpegAW9lWAMyPeTXAwucitPZQA6kpvgCdXSv8=",
  "base64"
);

/** That picture, encoded by ffmpeg's PNG encoder with each scanline filter (`-pred`). */
const ENCODED: Record<string, string> = {
  none: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAAX0lEQVR4nAFUAKv/AAAA/wA9DdqAehq1/7cnkE30NGvIABFh9IBObs//i3uqTciIhcgFlWAAACLC6f9fz8RNnNyfyNnpegAW9lWAADMj3k1wMLnIrT2UAOpKb4AnV0r/eiooF1SBCPwAAAAASUVORK5CYII=",
  sub: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAANElEQVR4nGNkYPjPYMt7uwGI64HYD4irGQUTv6AIALEFo9Khl/+RBUC6GI2V7/kiC4B0AQAk6CACosBhnQAAAABJRU5ErkJggg==",
  up: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAAMklEQVR4nGNkYPjPYMt7uwGI64HYD4irmQQTvzYAcT0Q+wFxNRBbMKELgBQxoQuAFAEAX74ibAYGUzcAAAAASUVORK5CYII=",
  avg: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAASElEQVR4nGNkYPjPYMt7uwGI64HYD4irmQUTSxvUzV/UA7EfEFcDsQWz1KT8/cgCy81fNDArHco6p74dKLD9hQUQNyzf/qIeADtoI74I/jwcAAAAAElFTkSuQmCC",
  paeth:
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAANUlEQVR4nGNkYPjPYMt7uwGI64HYD4irWQQTvzYI8n6tB2I/IK4GYguQIIoAEDeABFEEQLoA6oseggP7r20AAAAASUVORK5CYII=",
};

/** The same picture as 8-bit RGB, with no alpha. */
const RGB_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAIAAADJUWIXAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAAS0lEQVR4nAFAAL//AAAA/z0N2noatbcnkPQ0awARYfRObs+Le6rIiIUFlWAAIsLpX8/EnNyf2el6FvZVADMj3nAwua09lOpKbydXSqSRHccu5m0qAAAAAElFTkSuQmCC";

describe("a card still's pixels (png-rgba)", () => {
  it.each(Object.keys(ENCODED))(
    "decodes a PNG whose rows use the %s filter to straight RGBA",
    (filter) => {
      const still = decodePngRgba(Buffer.from(ENCODED[filter]!, "base64"));
      expect(still).toMatchObject({ width: 5, height: 4 });
      expect(still.rgba.equals(PIXELS)).toBe(true);
    }
  );

  it("refuses a PNG without alpha, and anything that is not a PNG, rather than draw it wrong", () => {
    expect(() => decodePngRgba(Buffer.from(RGB_PNG, "base64"))).toThrow(
      /not 8-bit RGBA/
    );
    expect(() => decodePngRgba(Buffer.from("GIF89a and the rest"))).toThrow(
      /not a PNG/
    );
  });
});

describe("the card server's arguments", () => {
  it("draws at 1920 unless told the stream's frame width", () => {
    expect(parseCardServerArgs([])).toEqual({
      frameWidth: 1920,
      prepare: false,
      help: false,
    });
    expect(
      parseCardServerArgs(["--frame-width", "1280", "--prepare"])
    ).toMatchObject({ frameWidth: 1280, prepare: true });
    expect(parseCardServerArgs(["-h"]).help).toBe(true);
  });

  it("refuses a frame width that is not a positive number, and any argument it does not know", () => {
    expect(() => parseCardServerArgs(["--frame-width", "wide"])).toThrow(
      "--frame-width must be a positive number."
    );
    expect(() => parseCardServerArgs(["--frame-width", "0"])).toThrow();
    expect(() => parseCardServerArgs(["--frame-width"])).toThrow();
    expect(() => parseCardServerArgs(["--fast"])).toThrow(
      "Unknown argument: --fast"
    );
  });
});

/** Lines written to a card server's stdin, readable as its readline would. */
const stdinLines = () => {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const lines: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) yield queue.shift()!;
        else if (closed) return;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
  return {
    lines,
    write: (text: string) => {
      queue.push(...text.split("\n").slice(0, -1));
      wake?.();
    },
    close: () => {
      closed = true;
      wake?.();
    },
  };
};

const READY = { width: 736, height: 344, startMs: 1100, warmRenderMs: 480 };

/** The real protocol, with each card drawn by `render`; every reply it wrote. */
const serve = (
  render: (card: { author: string; text: string }) => Promise<Buffer>
) => {
  const stdin = stdinLines();
  const replies: CardServerReply[] = [];
  const done = serveCardRequests({
    lines: stdin.lines,
    ready: READY,
    render,
    reply: (line) => replies.push(line),
    now: () => 0,
  });
  return { ...stdin, replies, done };
};

describe("the card server's line protocol", () => {
  it("says it is ready first, then answers each request in the order it came, however long each takes", async () => {
    const s = serve(async (card) => {
      await new Promise((r) => setTimeout(r, card.author === "@slow" ? 30 : 1));
      return Buffer.from(card.author);
    });

    s.write(
      [
        JSON.stringify({ id: "1", author: "@slow", text: "first" }),
        "",
        JSON.stringify({ id: "2", author: "@quick", text: "second" }),
        "quit",
        JSON.stringify({ id: "3", author: "@late", text: "after quit" }),
        "",
      ].join("\n")
    );
    await s.done;

    expect(s.replies).toEqual([
      { type: "ready", ...READY },
      {
        type: "card",
        id: "1",
        width: 736,
        height: 344,
        renderMs: 0,
        png: Buffer.from("@slow").toString("base64"),
      },
      {
        type: "card",
        id: "2",
        width: 736,
        height: 344,
        renderMs: 0,
        png: Buffer.from("@quick").toString("base64"),
      },
    ]);
  });

  it("answers a line it cannot read with an error that has no id, and a card it cannot draw with an error that has its id, and goes on serving", async () => {
    const s = serve(async (card) => {
      if (card.text === "boom") throw new Error("renderStill failed");
      return Buffer.from("png");
    });

    s.write("not json\n");
    s.write(`${JSON.stringify({ id: "7", author: "@a" })}\n`);
    s.write(`${JSON.stringify({ id: "8", author: "@a", text: "boom" })}\n`);
    s.write(`${JSON.stringify({ id: "9", author: "@a", text: "fine" })}\n`);
    s.close();
    await s.done;

    expect(
      s.replies.slice(1).map((r) => [r.type, "id" in r ? r.id : "-"])
    ).toEqual([
      ["error", null],
      ["error", null],
      ["error", "8"],
      ["card", "9"],
    ]);
    expect(s.replies[3]).toMatchObject({ message: "renderStill failed" });
  });
});

/** The real protocol as a launched process: its stdin, its stdout, `quit` exits 0. */
const realCardServer = (png: Buffer): LaunchedProcess => {
  const stdin = stdinLines();
  const out: ((chunk: string) => void)[] = [];
  const done = serveCardRequests({
    lines: stdin.lines,
    ready: { ...CARD_CANVAS, startMs: 1, warmRenderMs: 1 },
    render: async () => png,
    reply: (line) => {
      const text = `${JSON.stringify(line)}\n`;
      setImmediate(() => out.forEach((l) => l(text)));
    },
    now: () => 0,
  });
  return {
    onStdout: (l) => void out.push(l),
    onStderr: () => {},
    writeStdin: (text) => stdin.write(text),
    exited: done.then(() => new Promise((r) => setImmediate(() => r(0)))),
    kill: () => stdin.close(),
  };
};

describe.each([
  [
    "the scripted fake",
    () => fakeWindows().launch({ tool: "card-server", args: [] }),
  ],
  [
    "the real protocol",
    () => realCardServer(cardPng(CARD_CANVAS.width, CARD_CANVAS.height)),
  ],
])("the service's card server, against %s", (_, start) => {
  it("is ready at the stream's canvas size, answers each card as a still of that size, and exits 0 on quit", async () => {
    let started: LaunchedProcess | undefined;
    const server = createCardServer({
      launch: () => (started = start()),
      answerMs: 5_000,
    });

    expect(await server.size()).toEqual(CARD_CANVAS);
    const still = await server.render({ author: "@fake_viewer", text: "Hi" });
    const again = await server.render({ author: "@another", text: "Again" });
    await server.close();

    expect(still).toMatchObject(CARD_CANVAS);
    expect(still.rgba).toHaveLength(CARD_CANVAS.width * CARD_CANVAS.height * 4);
    // Opaque where the card is, clear around it.
    const alphaAt = (x: number, y: number) =>
      still.rgba[(y * CARD_CANVAS.width + x) * 4 + 3];
    expect(alphaAt(100, CARD_CANVAS.height - 60)).toBe(255);
    expect(alphaAt(0, 0)).toBe(0);
    expect(again.rgba.equals(still.rgba)).toBe(true);
    expect(await started!.exited).toBe(0);
  });
});
