import { describe, it, expect } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  applyDocumentToolCalls,
  collectDocumentToolCallIds,
  getStreamingDocument,
} from "./document-tool-calls";
import type { DocumentAgentMessage } from "./types";
import type { DocumentEdit } from "./document-editing-engine";

type Part = DocumentAgentMessage["parts"][number];

function assistant(...parts: Part[]): DocumentAgentMessage {
  return { id: `m-${parts.length}`, role: "assistant", parts };
}

function write(
  toolCallId: string,
  content: string,
  state: "input-available" | "input-streaming" = "input-available"
): Part {
  return fromPartial<Part>({
    type: "tool-writeDocument",
    toolCallId,
    state,
    input: { content },
  });
}

function edit(toolCallId: string, edits: DocumentEdit[]): Part {
  return fromPartial<Part>({
    type: "tool-editDocument",
    toolCallId,
    state: "input-available",
    input: { edits },
  });
}

const nothingProcessed = new Set<string>();

describe("applyDocumentToolCalls", () => {
  it("leaves the document alone when there is nothing to process", () => {
    const outcome = applyDocumentToolCalls({
      messages: [],
      document: "# Loader value",
      processedToolCallIds: nothingProcessed,
    });
    expect(outcome).toEqual({
      document: "# Loader value",
      processedToolCallIds: [],
      outputs: [],
    });
  });

  it("replaces the document with a writeDocument call's content", () => {
    const outcome = applyDocumentToolCalls({
      messages: [assistant(write("call-1", "# Written"))],
      document: "# Loader value",
      processedToolCallIds: nothingProcessed,
    });
    expect(outcome.document).toBe("# Written");
    expect(outcome.processedToolCallIds).toEqual(["call-1"]);
    expect(outcome.outputs).toEqual([
      {
        tool: "writeDocument",
        toolCallId: "call-1",
        output: "Document written successfully.",
      },
    ]);
  });

  it("applies an edit on top of a write from the same pass", () => {
    const outcome = applyDocumentToolCalls({
      messages: [
        assistant(write("call-1", "# Title\n\nBody.")),
        assistant(
          edit("call-2", [
            { type: "replace", old_text: "Body.", new_text: "Better body." },
          ])
        ),
      ],
      document: undefined,
      processedToolCallIds: nothingProcessed,
    });
    expect(outcome.document).toBe("# Title\n\nBetter body.");
    expect(outcome.processedToolCallIds).toEqual(["call-1", "call-2"]);
  });

  it("reports a failed edit without touching the document", () => {
    const outcome = applyDocumentToolCalls({
      messages: [
        assistant(
          edit("call-1", [
            { type: "replace", old_text: "missing", new_text: "x" },
          ])
        ),
      ],
      document: "# Loader value",
      processedToolCallIds: nothingProcessed,
    });
    expect(outcome.document).toBe("# Loader value");
    expect(outcome.outputs[0]!.output).toContain("not found in document");
  });

  it("skips tool calls that have already been processed", () => {
    const outcome = applyDocumentToolCalls({
      messages: [assistant(write("call-1", "# Stale draft"))],
      document: "# Loader value",
      processedToolCallIds: new Set(["call-1"]),
    });
    expect(outcome.document).toBe("# Loader value");
    expect(outcome.outputs).toEqual([]);
  });

  it("ignores calls whose input is still streaming", () => {
    const outcome = applyDocumentToolCalls({
      messages: [assistant(write("call-1", "# Half-w", "input-streaming"))],
      document: "# Loader value",
      processedToolCallIds: nothingProcessed,
    });
    expect(outcome.document).toBe("# Loader value");
    expect(outcome.processedToolCallIds).toEqual([]);
  });

  // The conversation outlives the session that produced it, so reopening the
  // writer replays messages whose writeDocument calls describe a document that
  // may since have been superseded. Marking those calls processed on mount is
  // what keeps the loader's value authoritative.
  describe("a restored conversation", () => {
    const restored = [assistant(write("call-1", "# Stale draft"))];

    it("cannot overwrite the value the loader supplied", () => {
      const outcome = applyDocumentToolCalls({
        messages: restored,
        document: "# Loader value",
        processedToolCallIds: new Set(collectDocumentToolCallIds(restored)),
      });
      expect(outcome.document).toBe("# Loader value");
    });

    it("does not block tool calls issued after the writer opened", () => {
      const outcome = applyDocumentToolCalls({
        messages: [...restored, assistant(write("call-2", "# Fresh"))],
        document: "# Loader value",
        processedToolCallIds: new Set(collectDocumentToolCallIds(restored)),
      });
      expect(outcome.document).toBe("# Fresh");
      expect(outcome.processedToolCallIds).toEqual(["call-2"]);
    });
  });
});

describe("collectDocumentToolCallIds", () => {
  it("collects settled document tool calls only", () => {
    expect(
      collectDocumentToolCallIds([
        assistant(
          write("call-1", "# One"),
          write("call-2", "# Two", "input-streaming")
        ),
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        assistant(edit("call-3", [{ type: "rewrite", new_text: "# Three" }])),
      ])
    ).toEqual(["call-1", "call-3"]);
  });
});

describe("getStreamingDocument", () => {
  it("returns the content of the in-flight write", () => {
    expect(
      getStreamingDocument([
        assistant(write("call-1", "# Half", "input-streaming")),
      ])
    ).toBe("# Half");
  });

  it("returns undefined when nothing is streaming", () => {
    expect(getStreamingDocument([assistant(write("call-1", "# Done"))])).toBe(
      undefined
    );
  });
});
