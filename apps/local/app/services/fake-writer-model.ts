import { anthropic } from "@ai-sdk/anthropic";
import { APICallError, type LanguageModel } from "ai";

/**
 * A scripted stand-in for Anthropic, so every way a writer turn can fail can
 * be forced on demand — in unit tests, and in a verify-cvm run, whose dud
 * Anthropic key otherwise only ever shows the auth error.
 *
 * Off unless the server starts with `CVM_FAKE_WRITER_MODEL=1`. The scenario is
 * picked by a directive in the user's message, `[fake:<scenario>]`:
 *
 * | scenario                | what the model does                                            |
 * | ----------------------- | -------------------------------------------------------------- |
 * | (none)                  | writes (or, with a document present, rewrites) the document    |
 * | `bad-tool-shape`        | sends malformed tool input once, then corrects itself          |
 * | `bad-tool-shape-always` | sends malformed tool input on every step                       |
 * | `edit-missing-old-text` | once, a `replace` edit with no `old_text`; then corrects itself |
 * | `overloaded-once`       | 529 on this message's first request, fine on its retry         |
 * | `rate-limit-once`       | 429 on this message's first request, fine on its retry         |
 * | `stream-drop-once`      | the stream dies mid-reply on the first request                 |
 * | `bad-request`           | 400 on every request                                           |
 * | `slow-write`            | writes a document with Choose Screenshots, over ~40 seconds    |
 *
 * A request for structured output (the Suggestions tab's) gets
 * `FAKE_SUGGESTION` back as JSON, a few characters at a time, whatever the
 * scenario.
 */
export const FAKE_WRITER_SCENARIOS = [
  "bad-tool-shape",
  "bad-tool-shape-always",
  "edit-missing-old-text",
  "overloaded-once",
  "rate-limit-once",
  "stream-drop-once",
  "bad-request",
  "slow-write",
] as const;

type V3Model = Extract<LanguageModel, { specificationVersion: "v3" }>;
type CallOptions = Parameters<V3Model["doStream"]>[0];
type StreamPart =
  Awaited<ReturnType<V3Model["doStream"]>>["stream"] extends ReadableStream<
    infer P
  >
    ? P
    : never;

/** The writer's model: Anthropic, or the fake when the seam is switched on. */
export function writerLanguageModel(modelId: string): LanguageModel {
  return process.env.CVM_FAKE_WRITER_MODEL === "1"
    ? createFakeWriterModel()
    : anthropic(modelId);
}

/** "-once" scenarios fail the first request per message text, process-wide. */
const failedOnce = new Set<string>();

export function createFakeWriterModel(
  opts: { calls?: CallOptions[] } = {}
): V3Model {
  return {
    specificationVersion: "v3",
    provider: "fake",
    modelId: "fake-writer",
    supportedUrls: {},
    doGenerate: () => {
      throw new Error("The fake writer model only streams.");
    },
    doStream: async (options) => {
      opts.calls?.push(options);
      const turn = readTurn(options);
      const once = (scenario: string) => {
        const key = `${scenario}\u0000${turn.text}`;
        if (failedOnce.has(key)) return false;
        failedOnce.add(key);
        return true;
      };

      if (turn.scenario === "overloaded-once" && once("overloaded")) {
        throw apiError(529, "overloaded_error", "Overloaded");
      }
      if (turn.scenario === "rate-limit-once" && once("rate-limit")) {
        throw apiError(429, "rate_limit_error", "Number of requests exceeded");
      }
      if (turn.scenario === "bad-request") {
        throw apiError(400, "invalid_request_error", "messages: bad shape");
      }

      const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (options.responseFormat?.type === "json") {
        parts.push(...textParts(JSON.stringify({ text: FAKE_SUGGESTION }), 12));
        parts.push(finish("stop"));
        return { stream: streamOf(parts) };
      }
      if (turn.scenario === "stream-drop-once" && once("stream-drop")) {
        parts.push(...textParts("Starting the draft…"), {
          type: "error",
          error: new Error("terminated"),
        });
        return { stream: streamOf(parts) };
      }

      const malformed =
        turn.scenario === "bad-tool-shape-always" ||
        (turn.scenario === "bad-tool-shape" && turn.rejectedAttempts === 0);
      const editMissingOldText =
        turn.scenario === "edit-missing-old-text" &&
        turn.hasDocument &&
        turn.rejectedAttempts === 0 &&
        turn.step === 0;
      const toolNames = (options.tools ?? []).map((t) => t.name);

      if (
        toolNames.includes("writeDocument") &&
        turn.scenario === "slow-write"
      ) {
        // Slow enough to edit the document while it streams in.
        parts.push(
          ...toolCallParts(turn, "writeDocument", { content: SLOW_DOCUMENT }, 6)
        );
        parts.push(finish("tool-calls"));
        return { stream: streamOf(parts, 120) };
      }

      if (!toolNames.includes("writeDocument")) {
        parts.push(...textParts(`Fake reply to: ${turn.text}`));
        parts.push(finish("stop"));
      } else if (malformed) {
        // `contents`, not `content`: the shape a model gets wrong.
        parts.push(
          ...toolCallParts(turn, "writeDocument", { contents: "# Oops" })
        );
        parts.push(finish("tool-calls"));
      } else if (editMissingOldText) {
        // A `replace` that forgot the passage it replaces.
        parts.push(
          ...toolCallParts(turn, "editDocument", {
            edits: [{ type: "replace", new_text: "Replaced", message: "fake" }],
          })
        );
        parts.push(finish("tool-calls"));
      } else {
        const markdown = `# Fake draft\n\nWritten by the fake writer model for: "${turn.text}"\n`;
        parts.push(
          ...(turn.hasDocument
            ? toolCallParts(turn, "editDocument", {
                edits: [
                  { type: "rewrite", new_text: markdown, message: "fake" },
                ],
              })
            : toolCallParts(turn, "writeDocument", { content: markdown }))
        );
        parts.push(finish("tool-calls"));
      }
      return { stream: streamOf(parts) };
    },
  };
}

type Turn = {
  scenario: string | undefined;
  /** The user's message, directive stripped. */
  text: string;
  /** Rejected tool results since that message: the model's failed tries. */
  rejectedAttempts: number;
  hasDocument: boolean;
  step: number;
};

function readTurn(options: CallOptions): Turn {
  // The latest user message carries the directive; the <current-document>
  // message the route appends after it does not count.
  let scenario: string | undefined;
  let text = "";
  let directiveIndex = -1;
  let hasDocument = false;
  options.prompt.forEach((message, index) => {
    if (message.role !== "user") return;
    for (const part of message.content) {
      if (part.type !== "text") continue;
      if (part.text.includes("<current-document>")) {
        hasDocument = true;
        continue;
      }
      scenario = /\[fake:([a-z-]+)\]/.exec(part.text)?.[1];
      text = part.text.replace(/\[fake:[a-z-]+\]/, "").trim();
      directiveIndex = index;
    }
  });
  let rejectedAttempts = 0;
  let step = 0;
  options.prompt.slice(directiveIndex + 1).forEach((message) => {
    if (message.role !== "tool") return;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      step++;
      if (part.output.type.startsWith("error")) rejectedAttempts++;
    }
  });
  return { scenario, text, rejectedAttempts, hasDocument, step };
}

function apiError(status: number, type: string, message: string) {
  return new APICallError({
    message,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: status,
    responseBody: JSON.stringify({ type: "error", error: { type, message } }),
    // Not retryable, so the SDK's own retries cannot hide the failure.
    isRetryable: false,
  });
}

/** `chunkSize` splits the text into many deltas, as a real model sends it. */
function textParts(text: string, chunkSize = Infinity): StreamPart[] {
  const deltas: StreamPart[] = [];
  const step = Math.max(1, Math.min(chunkSize, text.length));
  for (let at = 0; at < text.length; at += step) {
    deltas.push({
      type: "text-delta",
      id: "t",
      delta: text.slice(at, at + step),
    });
  }
  return [
    { type: "text-start", id: "t" },
    ...deltas,
    { type: "text-end", id: "t" },
  ];
}

/** The fake's Suggestion. */
export const FAKE_SUGGESTION =
  "Now let's look at the **next step** in the plan.";

const SLOW_DOCUMENT = [
  "# Slow draft",
  "",
  "An opening paragraph, written by the fake writer model.",
  "",
  '<ChooseScreenshot clipIndex={1} alt="The first screenshot" />',
  "",
  "A paragraph to delete while the rest streams in.",
  "",
  ...Array.from(
    { length: 12 },
    (_, i) =>
      `Paragraph ${i + 1} keeps the stream going for a while longer, so there is time to edit what has already arrived.\n`
  ),
  '<ChooseScreenshot clipIndex={1} alt="The last screenshot" />',
  "",
  "The end.",
  "",
].join("\n");

/** `chunkSize` splits the input into many deltas, as a real model sends it. */
function toolCallParts(
  turn: Turn,
  toolName: string,
  input: unknown,
  chunkSize = Infinity
): StreamPart[] {
  const id = `fake-${toolName}-${turn.step}-${Math.random().toString(36).slice(2, 8)}`;
  const json = JSON.stringify(input);
  const deltas: StreamPart[] = [];
  for (let at = 0; at < json.length; at += Math.min(chunkSize, json.length)) {
    deltas.push({
      type: "tool-input-delta",
      id,
      delta: json.slice(at, at + Math.min(chunkSize, json.length)),
    });
  }
  return [
    { type: "tool-input-start", id, toolName },
    ...deltas,
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input: json },
  ];
}

function finish(reason: "stop" | "tool-calls"): StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
  };
}

function streamOf(
  parts: StreamPart[],
  beatMs = 30
): ReadableStream<StreamPart> {
  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        // A beat between chunks, so the browser sees a reply stream in.
        await new Promise((resolve) => setTimeout(resolve, beatMs));
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}
