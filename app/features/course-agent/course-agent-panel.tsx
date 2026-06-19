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
  ChevronDown,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { CourseToolCall } from "./tool-call";
import { formatTokens, CONTEXT_WINDOW } from "./constants";

type StoredThread = {
  id: string;
  updatedAt: number;
  contextTokens: number;
  messages: UIMessage[];
  versionId?: string;
};

const THREADS_KEY = "course-agent-threads";
const ARCHIVED_KEY = "course-agent-archived-threads";

function loadThreads(courseId: string): StoredThread[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${THREADS_KEY}:${courseId}`);
    if (raw) return JSON.parse(raw) as StoredThread[];
  } catch {
    // ignore
  }
  return [];
}

function saveThreads(courseId: string, threads: StoredThread[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${THREADS_KEY}:${courseId}`, JSON.stringify(threads));
  } catch {
    // ignore
  }
}

function loadArchived(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [];
}

function saveArchived(ids: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

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
}: {
  courseId: string;
  versionId?: string;
  onClose: () => void;
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

  const { messages, setMessages, sendMessage, stop, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/courses/${courseId}/agent`,
      body: { versionId: threadVersionId },
    }),
    messages: thread.messages,
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
    <div className="fixed right-4 top-4 bottom-4 z-40 flex w-[400px] flex-col rounded-xl border border-border bg-card text-foreground shadow-2xl">
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

        <button
          className="ml-auto rounded p-1 hover:bg-muted"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
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
            const textParts = m.parts.filter(
              (p): p is { type: "text"; text: string } => p.type === "text"
            );
            const text = textParts.map((p) => p.text).join("\n\n");
            return (
              <AIMessage from="assistant" key={m.id}>
                <div className="w-full">
                  {m.parts.map((p, i) => {
                    if (p.type === "dynamic-tool" && isVfsTool(p.toolName)) {
                      const input = p.input as
                        | Record<string, string>
                        | undefined;
                      const pathArg = input?.path ?? input?.pattern ?? "";
                      return (
                        <CourseToolCall
                          key={i}
                          part={{
                            type: "tool",
                            tool: p.toolName as "ls" | "tree" | "cat" | "grep",
                            command: `${p.toolName} ${pathArg}`.trim(),
                            output:
                              p.state === "output-available"
                                ? String(p.output)
                                : "Running...",
                            touched: [],
                          }}
                        />
                      );
                    }
                    return null;
                  })}
                  {text && <AIResponse imageBasePath="">{text}</AIResponse>}
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

const VFS_TOOLS = new Set(["ls", "tree", "cat", "grep"]);
function isVfsTool(name: string): boolean {
  return VFS_TOOLS.has(name);
}

function extractUsageFromMessage(
  message: UIMessage
): { inputTokens: number; outputTokens: number } | null {
  const meta = message.metadata as
    | { usage?: { inputTokens?: number; outputTokens?: number } }
    | undefined;
  if (meta?.usage?.inputTokens != null) {
    return {
      inputTokens: meta.usage.inputTokens,
      outputTokens: meta.usage.outputTokens ?? 0,
    };
  }
  return null;
}
