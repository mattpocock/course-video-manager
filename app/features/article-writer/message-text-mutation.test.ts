import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createMessageTextMutator } from "./message-text-mutation";
import { replaceChooseScreenshotWithImage } from "./choose-screenshot-mutations";
import type { DocumentAgentMessage } from "./types";

const message = (
  id: string,
  role: "user" | "assistant",
  text: string
): DocumentAgentMessage =>
  fromPartial<DocumentAgentMessage>({
    id,
    role,
    parts: [{ type: "text", text }],
  });

const textOf = (msg: DocumentAgentMessage | undefined) =>
  msg?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ??
  "";

const tag = (clipIndex: number, alt: string) =>
  `<ChooseScreenshot clipIndex={${clipIndex}} alt="${alt}" />`;

describe("createMessageTextMutator", () => {
  it("keeps the tool calls in a message it rewrites", () => {
    // A captured screenshot must not cost the message its writeDocument call —
    // that is what renders the document panel alongside the reply.
    const mutator = createMessageTextMutator([
      fromPartial<DocumentAgentMessage>({
        id: "m1",
        role: "assistant",
        parts: [
          { type: "tool-writeDocument", state: "output-available" },
          { type: "text", text: tag(3, "the error") },
        ],
      }),
    ]);

    const result = mutator.mutate("m1", (text) =>
      replaceChooseScreenshotWithImage(text, 3, "the error", "./shot-1.png")
    );

    expect(result[0]!.parts[0]).toEqual({
      type: "tool-writeDocument",
      state: "output-available",
    });
    expect(textOf(result[0])).toBe("![the error](./shot-1.png)");
  });

  it("leaves the messages it was given untouched", () => {
    // The caller hands these straight back to React, which compares by
    // identity — rewriting in place would lose the re-render.
    const original = [message("m1", "assistant", tag(3, "the error"))];
    const mutator = createMessageTextMutator(original);

    mutator.mutate("m1", (text) =>
      replaceChooseScreenshotWithImage(text, 3, "the error", "./shot-1.png")
    );

    expect(textOf(original[0])).toBe(tag(3, "the error"));
  });

  it("rebases a mutation onto messages that arrived while it was in flight", () => {
    // The user clicks Capture, which awaits an HTTP round-trip...
    const mutator = createMessageTextMutator([
      message("m1", "assistant", `Here you go\n\n${tag(3, "the error")}`),
    ]);

    // ...and submits a follow-up message before the capture comes back.
    mutator.sync([
      message("m1", "assistant", `Here you go\n\n${tag(3, "the error")}`),
      message("m2", "user", "actually, make it shorter"),
      message("m3", "assistant", "Sure —"),
    ]);

    const result = mutator.mutate("m1", (text) =>
      replaceChooseScreenshotWithImage(text, 3, "the error", "./shot-1.png")
    );

    expect(result).toHaveLength(3);
    expect(textOf(result[0])).toBe("Here you go\n\n![the error](./shot-1.png)");
    expect(textOf(result[1])).toBe("actually, make it shorter");
    expect(textOf(result[2])).toBe("Sure —");
  });

  it("composes mutations that resolve back to back, before any re-render", () => {
    const mutator = createMessageTextMutator([
      message("m1", "assistant", `${tag(1, "before")}\n\n${tag(2, "after")}`),
    ]);

    mutator.mutate("m1", (text) =>
      replaceChooseScreenshotWithImage(text, 1, "before", "./shot-1.png")
    );
    const result = mutator.mutate("m1", (text) =>
      replaceChooseScreenshotWithImage(text, 2, "after", "./shot-2.png")
    );

    expect(textOf(result[0])).toBe(
      "![before](./shot-1.png)\n\n![after](./shot-2.png)"
    );
  });

  it("cannot resurrect a message that was cleared while it was in flight", () => {
    const mutator = createMessageTextMutator([
      message("m1", "assistant", tag(3, "the error")),
    ]);

    mutator.sync([]);

    expect(
      mutator.mutate("m1", (text) =>
        replaceChooseScreenshotWithImage(text, 3, "the error", "./shot-1.png")
      )
    ).toEqual([]);
  });
});
