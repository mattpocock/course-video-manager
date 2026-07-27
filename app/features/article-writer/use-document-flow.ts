import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDocumentToolCalls,
  collectDocumentToolCallIds,
  getStreamingDocument,
} from "./document-tool-calls";
import type { DocumentAgentMessage, Mode } from "./types";

/**
 * Manages the working document for the article-mode document flow: executes
 * `writeDocument`/`editDocument` tool calls client-side and streams the
 * document in live while the model writes it.
 *
 * The document is deliberately **not** persisted. Its single source of truth is
 * `initialDocument`, supplied by the route loader (i.e. the database), and it
 * lives in memory for the life of the writer. Chat messages *are* persisted to
 * localStorage by the caller — which is why a restored conversation's tool
 * calls are marked processed on mount: replaying them would otherwise overwrite
 * the loader's value with output from a previous session.
 */
export function useDocumentFlow(opts: {
  /** The persisted value from the route loader — the source of truth. */
  initialDocument?: string;
  mode: Mode;
  isDocumentMode: boolean;
  messages: DocumentAgentMessage[];
  status: "streaming" | "submitted" | "ready" | "error";
  addToolOutput: (args: {
    tool: "writeDocument" | "editDocument";
    toolCallId: string;
    output: string;
  }) => Promise<void>;
  /** Notified on every document change, including AI-driven ones. */
  onDocumentChange?: (document: string) => void;
}) {
  const {
    initialDocument,
    mode,
    isDocumentMode,
    messages,
    status,
    addToolOutput,
    onDocumentChange,
  } = opts;

  const [document, setDocumentState] = useState<string | undefined>(
    initialDocument
  );

  // Ref tracks latest document for use in async callbacks and effects that must
  // not re-run when it changes (avoids stale closures without extra deps).
  const documentRef = useRef(document);
  documentRef.current = document;

  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  const setDocument = useCallback((content: string | undefined) => {
    setDocumentState(content);
    documentRef.current = content;
    onDocumentChangeRef.current?.(content ?? "");
  }, []);

  const processedToolCallsRef = useRef<Set<string>>(
    // On mount, treat every tool call in the restored conversation as already
    // executed: the loader owns the document, not the transcript.
    new Set(collectDocumentToolCallIds(messages))
  );

  // Switching mode swaps in that mode's stored conversation, whose tool calls
  // belong to an earlier session — mark them processed for the same reason.
  // The document itself is unaffected: a field has one working document,
  // whichever mode wrote it.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    processedToolCallsRef.current = new Set(
      collectDocumentToolCallIds(messages)
    );
  }, [mode, messages]);

  // Execute newly-settled document tool calls.
  useEffect(() => {
    if (!isDocumentMode) return;
    const outcome = applyDocumentToolCalls({
      messages,
      document: documentRef.current,
      processedToolCallIds: processedToolCallsRef.current,
    });
    if (outcome.processedToolCallIds.length === 0) return;
    for (const id of outcome.processedToolCallIds) {
      processedToolCallsRef.current.add(id);
    }
    setDocument(outcome.document);
    for (const output of outcome.outputs) {
      addToolOutput(output);
    }
  }, [messages, isDocumentMode, addToolOutput, setDocument]);

  // Stream document content live during an in-flight writeDocument call.
  useEffect(() => {
    if (!isDocumentMode) return;
    if (status !== "streaming" && status !== "submitted") return;
    const streaming = getStreamingDocument(messages);
    if (streaming !== undefined) setDocument(streaming);
  }, [messages, isDocumentMode, status, setDocument]);

  /** Drop the session's work and return to the loader's value. */
  const resetDocument = useCallback(() => {
    setDocument(initialDocument);
    processedToolCallsRef.current.clear();
  }, [initialDocument, setDocument]);

  return { document, documentRef, resetDocument, updateDocument: setDocument };
}
