import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderOverlayFrame } from "../src/render";
import { colouredPixels } from "./png-pixels";

/**
 * #2658: emoji in a chat message must be drawn in colour wherever the card
 * is rendered, not only in the browser preview. Both renderers run in
 * Chromium under WSL, which has no emoji font of its own, so these render for
 * real. Chromium is slow to start: run them on their own.
 */

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const PLAIN = { author: "@fixture_viewer", text: "ship it" };
const EMOJI = { author: "@fixture_viewer", text: "ship it 🚀🔥👍" };

/** Each card's PNG from one run of the card server, as the recorder asks. */
const cardServerStills = (
  cards: { author: string; text: string }[]
): Promise<Buffer[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["card-server.mjs"], {
      cwd: packageRoot,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const stills: Buffer[] = [];
    let pending = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const reply = JSON.parse(line);
        if (reply.type === "ready")
          cards.forEach((card, i) =>
            child.stdin.write(`${JSON.stringify({ id: String(i), ...card })}\n`)
          );
        if (reply.type === "error") reject(new Error(reply.message));
        if (reply.type === "card") {
          stills[Number(reply.id)] = Buffer.from(reply.png, "base64");
          if (stills.filter(Boolean).length === cards.length) {
            child.stdin.end();
            resolve(stills);
          }
        }
      }
    });
    child.on("exit", (code) => reject(new Error(`card server exited ${code}`)));
  });

/** One landed frame of a Short's overlay showing this Chat Card. */
const shortChatCardFrame = async (card: { author: string; text: string }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-card-emoji-"));
  const outputLocation = path.join(dir, "frame.png");
  await renderOverlayFrame(
    {
      fps: 60,
      durationInFrames: 2,
      chatCards: [{ ...card, cells: [], startFrame: 0, durationInFrames: 2 }],
    },
    { frame: 1, outputLocation }
  );
  const png = fs.readFileSync(outputLocation);
  fs.rmSync(dir, { recursive: true, force: true });
  return png;
};

// Three 32 px emoji are thousands of coloured pixels; tofu or blanks add none.
const EMOJI_PIXELS = 1_000;

describe("emoji on a Chat Card (#2658)", () => {
  it("are drawn in colour on the Live Stream's card still", async () => {
    const [plain, emoji] = await cardServerStills([PLAIN, EMOJI]);
    expect(colouredPixels(emoji!) - colouredPixels(plain!)).toBeGreaterThan(
      EMOJI_PIXELS
    );
  }, 120_000);

  it("are drawn in colour on a Short's Chat Card", async () => {
    const plain = await shortChatCardFrame(PLAIN);
    const emoji = await shortChatCardFrame(EMOJI);
    expect(colouredPixels(emoji) - colouredPixels(plain)).toBeGreaterThan(
      EMOJI_PIXELS
    );
  }, 180_000);
});
