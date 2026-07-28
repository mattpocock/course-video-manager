import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  applyTextMutation,
  createMessageTextMutator,
} from "./message-text-mutation";
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

describe("applyTextMutation", () => {
  it("mutates the text parts of the addressed message only", () => {
    const messages = [
      message("m1", "assistant", "first"),
      message("m2", "assistant", "second"),
    ];

    const result = applyTextMutation(messages, "m2", (t) => t.toUpperCase());

    expect(textOf(result[0])).toBe("first");
    expect(textOf(result[1])).toBe("SECOND");
  });

  it("leaves non-text parts untouched", () => {
    const withTool = fromPartial<DocumentAgentMessage>({
      id: "m1",
      role: "assistant",
      parts: [
        { type: "tool-writeDocument", state: "output-available" },
        { type: "text", text: "hello" },
      ],
    });

    const result = applyTextMutation([withTool], "m1", (t) => `${t}!`);

    expect(result[0]!.parts[0]).toEqual({
      type: "tool-writeDocument",
      state: "output-available",
    });
    expect(textOf(result[0])).toBe("hello!");
  });

  it("does not mutate the messages it is given", () => {
    const messages = [message("m1", "assistant", "original")];

    applyTextMutation(messages, "m1", () => "changed");

    expect(textOf(messages[0])).toBe("original");
  });

  it("is a no-op when no message matches", () => {
    const messages = [message("m1", "assistant", "only")];

    const result = applyTextMutation(messages, "gone", () => "changed");

    expect(result.map(textOf)).toEqual(["only"]);
  });
});

describe("createMessageTextMutator", () => {
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
