"use client";

import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  AIConversation,
  AIConversationContent,
  AIConversationScrollButton,
} from "components/ui/kibo-ui/ai/conversation";
import {
  AIInput,
  AIInputSubmit,
  AIInputTextarea,
  AIInputToolbar,
} from "components/ui/kibo-ui/ai/input";
import { AIMessage, AIMessageContent } from "components/ui/kibo-ui/ai/message";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Copy,
  MessageSquarePlus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRevalidator } from "react-router";
import { DefaultChatTransport } from "ai";
import { CourseToolCall } from "./tool-call";
import { formatTokens, CONTEXT_WINDOW } from "./constants";
import {
  courseAgentSendAutomaticallyWhen,
  type ProposedOps,
  type WriteResult,
  type CourseAgentUIMessage,
} from "./types";
import { ApprovalCard, InvalidEditLine } from "./approval-card";
import { findAppliedToolCallIds } from "./revalidation-trigger";
import {
  type StoredThread,
  loadThreads,
  saveThreads,
  loadArchived,
  saveArchived,
} from "./thread-storage";
import { formatTranscript } from "./format-transcript";
import {
  asVfsToolPart,
  asWriteToolPart,
  extractUsageFromMessage,
} from "./tool-part-helpers";

function updatedLabel(ts: number): string {
  const label =
    Date.now() - ts < 60_000
      ? "now"
      : formatDistanceToNow(ts, { addSuffix: true });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function CourseAgentPanel({
  courseId,
  versionId,
  onClose,
  embedded = false,
}: {
  courseId: string;
  versionId?: string;
  onClose: () => void;
  // When true, the panel fills its parent (no fixed/overlay chrome) so a
  // surrounding shell can own the frame. Used by the sidebar layout.
  embedded?: boolean;
}) {
  const [threads, setThreads] = useState<StoredThread[]>(() => {
    const stored = loadThreads(courseId);
    if (stored.length > 0) return stored;
    return [
      {
        id: `thread-${Date.now()}`,
        updatedAt: Date.now(),
        contextTokens: 0,
        messages: [],
        versionId,
      },
    ];
  });
  const [archivedIds, setArchivedIds] = useState<string[]>(() =>
    loadArchived()
  );
  const [activeId, setActiveId] = useState<string>(() => {
    const archived = new Set(loadArchived());
    const active = threads.find((t) => !archived.has(t.id));
    return active?.id ?? threads[0]!.id;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const newCount = useRef(0);

  const archived = useMemo(() => new Set(archivedIds), [archivedIds]);
  const activeThreads = threads.filter((t) => !archived.has(t.id));
  const archivedThreads = threads.filter((t) => archived.has(t.id));
  const thread =
    threads.find((t) => t.id === activeId) ?? activeThreads[0] ?? threads[0]!;

  const threadVersionId = thread.versionId ?? versionId;

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    status,
    addToolApprovalResponse,
  } = useChat<CourseAgentUIMessage>({
    transport: new DefaultChatTransport({
      api: `/api/courses/${courseId}/agent`,
      body: { versionId: threadVersionId },
    }),
    messages: thread.messages as CourseAgentUIMessage[],
    sendAutomaticallyWhen: courseAgentSendAutomaticallyWhen,
    onFinish({ message }) {
      const usage = extractUsageFromMessage(message);
      setThreads((prev) => {
        const updated = prev.map((t) =>
          t.id === activeId
            ? {
                ...t,
                updatedAt: Date.now(),
                contextTokens: usage?.inputTokens ?? t.contextTokens,
              }
            : t
        );
        saveThreads(courseId, updated);
        return updated;
      });
    },
  });

  // Revalidate the course route when a write/edit is successfully applied.
  const revalidator = useRevalidator();
  const appliedRef = useRef(new Set<string>());
  useEffect(() => {
    const current = findAppliedToolCallIds(messages);
    let shouldRevalidate = false;
    for (const id of current) {
      if (!appliedRef.current.has(id)) {
        shouldRevalidate = true;
        appliedRef.current.add(id);
      }
    }
    if (shouldRevalidate) {
      revalidator.revalidate();
    }
  }, [messages, revalidator]);

  // Build a lookup of proposed ops keyed by toolCallId, for the approval card.
  const proposedOpsMap = useMemo(() => {
    const map = new Map<string, ProposedOps>();
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (
          (part as { type: string }).type === "data-proposed-ops" &&
          (part as { id?: string }).id &&
          (part as { data?: ProposedOps }).data
        ) {
          const dp = part as { id: string; data: ProposedOps };
          map.set(dp.id, dp.data);
        }
      }
    }
    return map;
  }, [messages]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingThreadsRef = useRef<StoredThread[] | null>(null);
  useEffect(() => {
    setThreads((prev) => {
      const updated = prev.map((t) =>
        t.id === activeId ? { ...t, messages, updatedAt: Date.now() } : t
      );
      pendingThreadsRef.current = updated;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (pendingThreadsRef.current) {
          saveThreads(courseId, pendingThreadsRef.current);
          pendingThreadsRef.current = null;
        }
      }, 500);
      return updated;
    });
  }, [messages, activeId, courseId]);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pendingThreadsRef.current) {
        saveThreads(courseId, pendingThreadsRef.current);
      }
    };
  }, [courseId]);

  const contextTokens = useMemo(() => {
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const usage = lastAssistant ? extractUsageFromMessage(lastAssistant) : null;
    return usage?.inputTokens ?? thread.contextTokens;
  }, [messages, thread.contextTokens]);

  const setArchivedAndSave = (ids: string[]) => {
    setArchivedIds(ids);
    saveArchived(ids);
  };

  const archiveThread = (id: string) => {
    setArchivedAndSave([...archivedIds.filter((x) => x !== id), id]);
    if (id === activeId) {
      const next = threads.find((t) => t.id !== id && !archived.has(t.id));
      if (next) {
        setActiveId(next.id);
        setMessages(next.messages);
      }
    }
  };

  const unarchiveThread = (id: string) => {
    setArchivedAndSave(archivedIds.filter((x) => x !== id));
  };

  const newThread = () => {
    newCount.current += 1;
    const t: StoredThread = {
      id: `thread-${Date.now()}-${newCount.current}`,
      updatedAt: Date.now(),
      contextTokens: 0,
      messages: [],
      versionId,
    };
    setThreads((prev) => {
      const updated = [t, ...prev];
      saveThreads(courseId, updated);
      return updated;
    });
    setActiveId(t.id);
    setMessages([]);
    setMenuOpen(false);
  };

  const switchThread = (id: string) => {
    const target = threads.find((t) => t.id === id);
    if (target) {
      setActiveId(id);
      setMessages(target.messages);
    }
    setMenuOpen(false);
  };

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    setDraft("");
  }, [draft, sendMessage]);

  const isStreaming = status === "streaming" || status === "submitted";

  return (
    <div
      className={cn(
        "flex flex-col bg-card text-foreground",
        embedded
          ? "h-full w-full"
          : "fixed right-4 top-4 bottom-4 z-40 w-[400px] rounded-xl border border-border shadow-2xl"
      )}
    >
      {/* header: thread switcher + token pill + close */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold hover:bg-muted"
          >
            Current Chat
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
              {activeThreads.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "group flex items-center rounded hover:bg-muted",
                    t.id === thread.id && "bg-muted"
                  )}
                >
                  <button
                    onClick={() => switchThread(t.id)}
                    className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-left text-sm"
                  >
                    <span className="truncate">
                      {t.id === thread.id
                        ? "Current Chat"
                        : updatedLabel(t.updatedAt)}
                    </span>
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                      {formatTokens(t.contextTokens)}
                    </span>
                  </button>
                  <button
                    title="Archive chat"
                    onClick={() => archiveThread(t.id)}
                    className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Archive className="size-3.5" />
                  </button>
                </div>
              ))}

              <button
                onClick={newThread}
                className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                <MessageSquarePlus className="size-3.5" /> New chat
              </button>

              {archivedThreads.length > 0 && (
                <div className="mt-1 border-t border-border pt-1">
                  <button
                    onClick={() => setShowArchived((s) => !s)}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        !showArchived && "-rotate-90"
                      )}
                    />
                    Archived ({archivedThreads.length})
                  </button>
                  {showArchived &&
                    archivedThreads.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-center rounded hover:bg-muted"
                      >
                        <button
                          onClick={() => switchThread(t.id)}
                          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-muted-foreground"
                        >
                          {updatedLabel(t.updatedAt)}
                        </button>
                        <button
                          title="Unarchive chat"
                          onClick={() => unarchiveThread(t.id)}
                          className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ArchiveRestore className="size-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            title="Copy transcript"
            className="rounded p-1 hover:bg-muted"
            onClick={async () => {
              const text = formatTranscript(messages);
              if (!text) return;
              try {
                await navigator.clipboard.writeText(text);
                toast("Chat transcript copied to clipboard");
              } catch {
                toast.error("Failed to copy to clipboard");
              }
            }}
          >
            <Copy className="size-4" />
          </button>
          <button className="rounded p-1 hover:bg-muted" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* conversation */}
      <AIConversation className="flex-1">
        <AIConversationContent>
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-muted-foreground">
              Ask anything about this course.
            </div>
          )}
          {messages.map((m) => {
            if (m.role === "user") {
              const text = m.parts
                .filter(
                  (p): p is { type: "text"; text: string } => p.type === "text"
                )
                .map((p) => p.text)
                .join("\n\n");
              return (
                <AIMessage from="user" key={m.id}>
                  <AIMessageContent>{text}</AIMessageContent>
                </AIMessage>
              );
            }
            return (
              <AIMessage from="assistant" key={m.id}>
                <div className="w-full">
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      return p.text ? (
                        <AIResponse
                          key={i}
                          imageBasePath=""
                          className="text-sm"
                        >
                          {p.text}
                        </AIResponse>
                      ) : null;
                    }

                    // Data parts are rendered through their correlated tool part
                    if ((p as { type: string }).type === "data-proposed-ops") {
                      return null;
                    }

                    // Write/edit tool parts — approval cards, invalid-edit lines, and apply confirmations
                    const writeTool = asWriteToolPart(p);
                    if (writeTool) {
                      const proposed = proposedOpsMap.get(writeTool.toolCallId);

                      if (
                        writeTool.state === "approval-requested" &&
                        proposed
                      ) {
                        return (
                          <div key={i} className="my-3">
                            <ApprovalCard
                              proposed={proposed}
                              disabled={isStreaming}
                              onApprove={() =>
                                addToolApprovalResponse({
                                  id: writeTool.approval!.id,
                                  approved: true,
                                })
                              }
                              onReject={() =>
                                addToolApprovalResponse({
                                  id: writeTool.approval!.id,
                                  approved: false,
                                  reason: "User rejected this edit.",
                                })
                              }
                            />
                          </div>
                        );
                      }

                      if (writeTool.state === "output-available") {
                        const result = writeTool.output as
                          | WriteResult
                          | undefined;
                        if (result?.applied === false) {
                          return (
                            <div key={i} className="my-2">
                              <InvalidEditLine
                                message={result.rejection.message}
                              />
                            </div>
                          );
                        }
                        if (result?.applied === true) {
                          return (
                            <div
                              key={i}
                              className="my-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                            >
                              <Check className="size-3.5 text-green-600" />
                              <span>Edit applied successfully.</span>
                            </div>
                          );
                        }
                      }

                      if (writeTool.state === "output-denied") {
                        return (
                          <div
                            key={i}
                            className="my-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                          >
                            <XCircle className="size-3.5" />
                            <span>You rejected this edit.</span>
                          </div>
                        );
                      }

                      // input-streaming / input-available / approval-responded — nothing to render
                      return null;
                    }

                    const vfs = asVfsToolPart(p);
                    if (!vfs) return null;
                    const pathArg = vfs.input?.path ?? vfs.input?.pattern ?? "";
                    return (
                      <CourseToolCall
                        key={i}
                        part={{
                          type: "tool",
                          tool: vfs.toolName,
                          command: `${vfs.toolName} ${pathArg}`.trim(),
                          output:
                            vfs.state === "output-available"
                              ? String(vfs.output)
                              : "Running...",
                          touched: [],
                        }}
                      />
                    );
                  })}
                </div>
              </AIMessage>
            );
          })}
        </AIConversationContent>
        <AIConversationScrollButton />
      </AIConversation>

      {/* input */}
      <div className="border-t border-border p-3">
        <AIInput
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <AIInputTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the course agent..."
          />
          <AIInputToolbar>
            <span
              title={`${contextTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()} tokens`}
              className="px-2 text-[11px] font-medium tabular-nums text-muted-foreground"
            >
              {formatTokens(contextTokens)} / {formatTokens(CONTEXT_WINDOW)}
            </span>
            <AIInputSubmit
              status={isStreaming ? "streaming" : "ready"}
              onStop={stop}
            />
          </AIInputToolbar>
        </AIInput>
      </div>
    </div>
  );
}
