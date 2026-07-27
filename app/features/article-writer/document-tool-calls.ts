/**
 * Pure reduction of a chat transcript's document tool calls (`writeDocument`,
 * `editDocument`) into a document string.
 *
 * The writer executes these tools client-side: the model emits a tool call, the
 * UI folds it into the working document and reports an output back to the chat.
 * Keeping the fold pure means the hook that drives it is a single effect over
 * `messages` rather than one effect per tool, and the interesting cases (an edit
 * landing on top of a write, a failed edit, a replayed transcript) are testable
 * without React.
 */

import { applyEdits, type DocumentEdit } from "./document-editing-engine";
import type { DocumentAgentMessage } from "./types";

export type DocumentToolOutput = {
  tool: "writeDocument" | "editDocument";
  toolCallId: string;
  output: string;
};

export type DocumentToolCallOutcome = {
  /** The document after folding in every not-yet-processed tool call. */
  document: string | undefined;
  /** Tool call ids folded in by this pass — none of them were processed before. */
  processedToolCallIds: string[];
  /** Outputs to report back to the chat, in the order they were produced. */
  outputs: DocumentToolOutput[];
};

type DocumentToolPart = Extract<
  DocumentAgentMessage["parts"][number],
  { type: "tool-writeDocument" | "tool-editDocument" }
>;

/** The same union, with `input` known to have arrived. */
type SettledDocumentToolPart = DocumentToolPart extends infer Part
  ? Part extends DocumentToolPart
    ? Part & { input: NonNullable<Part["input"]> }
    : never
  : never;

/**
 * A tool call whose input has stopped streaming, and so can be executed.
 * `input-streaming` parts are handled by {@link getStreamingDocument} instead.
 */
function isSettledDocumentToolCall(
  part: DocumentAgentMessage["parts"][number]
): part is SettledDocumentToolPart {
  return (
    (part.type === "tool-writeDocument" || part.type === "tool-editDocument") &&
    part.state !== "input-streaming" &&
    Boolean(part.input)
  );
}

function* settledDocumentToolCalls(messages: DocumentAgentMessage[]) {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (isSettledDocumentToolCall(part)) yield part;
    }
  }
}

/**
 * Every settled document tool call in the transcript. Used to mark a restored
 * conversation's tool calls as already-processed, so replaying old messages
 * never overwrites the document the route loader supplied.
 */
export function collectDocumentToolCallIds(
  messages: DocumentAgentMessage[]
): string[] {
  return Array.from(settledDocumentToolCalls(messages), (p) => p.toolCallId);
}

/**
 * Fold every tool call not present in `processedToolCallIds` into `document`,
 * in transcript order, so an edit sees the document as left by an earlier write.
 */
export function applyDocumentToolCalls(opts: {
  messages: DocumentAgentMessage[];
  document: string | undefined;
  processedToolCallIds: ReadonlySet<string>;
}): DocumentToolCallOutcome {
  const { messages, document, processedToolCallIds } = opts;

  let current = document;
  const processed: string[] = [];
  const outputs: DocumentToolOutput[] = [];

  for (const part of settledDocumentToolCalls(messages)) {
    if (processedToolCallIds.has(part.toolCallId)) continue;
    processed.push(part.toolCallId);

    if (part.type === "tool-writeDocument") {
      current = part.input.content;
      outputs.push({
        tool: "writeDocument",
        toolCallId: part.toolCallId,
        output: "Document written successfully.",
      });
      continue;
    }

    const result = applyEdits(
      current ?? "",
      part.input.edits as DocumentEdit[]
    );
    if ("error" in result) {
      outputs.push({
        tool: "editDocument",
        toolCallId: part.toolCallId,
        output: result.error,
      });
    } else {
      current = result.document;
      outputs.push({
        tool: "editDocument",
        toolCallId: part.toolCallId,
        output: "Document edited successfully.",
      });
    }
  }

  return { document: current, processedToolCallIds: processed, outputs };
}

/**
 * The content of the last in-flight `writeDocument` call, so the document panel
 * can render the article as the model types it. Returns undefined when nothing
 * is streaming.
 */
export function getStreamingDocument(
  messages: DocumentAgentMessage[]
): string | undefined {
  let streaming: string | undefined;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        part.type === "tool-writeDocument" &&
        part.state === "input-streaming" &&
        part.input?.content
      ) {
        streaming = part.input.content;
      }
    }
  }
  return streaming;
}
