import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WriteChat, type WriteChatProps } from "./write-chat";
import type { DocumentAgentMessage } from "./types";

const messages: DocumentAgentMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "FIRST-QUESTION" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "FIRST-REPLY" }],
  },
  {
    id: "u2",
    role: "user",
    parts: [{ type: "text", text: "SECOND-QUESTION" }],
  },
];

const render = (overrides: Partial<WriteChatProps>) =>
  renderToStaticMarkup(
    <WriteChat
      messages={messages}
      setMessages={() => {}}
      failure={null}
      onRetry={() => {}}
      onRegenerate={() => {}}
      fullPath=""
      onSubmit={() => {}}
      onStop={() => {}}
      status="ready"
      indexedClips={[]}
      videoId="v1"
      {...overrides}
    />
  );

describe("WriteChat", () => {
  // It used to render above the first message, scrolled out of sight.
  it("shows a failed turn after the last message, with Retry", () => {
    const html = render({
      status: "error",
      failure: { kind: "overloaded", message: "OVERLOADED-DETAIL" },
    });

    const alert = html.indexOf('role="alert"');
    expect(alert).toBeGreaterThan(html.indexOf("SECOND-QUESTION"));
    expect(html.indexOf("OVERLOADED-DETAIL")).toBeGreaterThan(alert);
    expect(html.slice(alert)).toContain("Retry");
  });

  it("offers Regenerate under a finished reply, and nothing once a new message waits", () => {
    const finished = render({ messages: messages.slice(0, 2) });
    expect(finished).toContain("Regenerate reply");
    expect(render({})).not.toContain("Regenerate reply");
  });
});
