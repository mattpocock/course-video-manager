"use client";

import type {
  Mode,
  DocumentAgentMessage,
  WriterContext,
  WriterView,
} from "./types";

export type { WriterContext };
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { WriteChat } from "./write-chat";
import { DocumentPanel } from "./document-panel";
import { useDocumentFlow } from "./use-document-flow";
import { useRemoveDocumentBlock } from "./use-remove-document-block";
import { useLint, useLintContext, useLintFix } from "@/hooks/use-lint";
import { useBannedPhrases } from "@/hooks/use-banned-phrases";
import { useMessageQueue } from "./use-message-queue";
import { partsToText } from "./write-utils";
import { hasUnresolvedScreenshots } from "./choose-screenshot-mutations";
import {
  preprocessDocumentPreview,
  type DocumentPreviewOptions,
} from "./document-preview-markdown";
import { ChooseScreenshotProvider } from "./choose-screenshot-components";
import { useDocScreenshotRuntime } from "./use-doc-screenshot-runtime";
import { useWriterTurn } from "./use-writer-turn";
import {
  PREVIEW_COMPONENTS,
  PREVIEW_COMPONENTS_WITH_SCREENSHOTS,
} from "./preview-component-maps";
import { QuizProvider, type QuizRuntime } from "./quiz-components";
import { removeQuizQuestion } from "./quiz-syntax";
import type { WriteToolbarProps } from "./write-toolbar";
import type { WriterFieldId } from "./writer-engine-utils";
import {
  constrainModes,
  defaultModeForRole,
  loadFieldMessages,
  saveFieldMessages,
} from "./writer-engine-utils";
import { useContextModel } from "./use-context-model";
import { useMemoryAutosave } from "./use-memory-autosave";
import { useApplyDocument } from "./use-apply-document";
import { ApplyButton } from "./apply-button";
import { InlineContextStrip } from "./inline-context-strip";
import { ContextView } from "./context-view";
import { SettingsView } from "./settings-view";
import { WriteModeDropdown } from "./write-mode-dropdown";
import {
  useArticleWriterModel,
  WriteModelSelector,
} from "./write-model-selector";
import { Button } from "@/components/ui/button";
import {
  RefreshCwIcon,
  Trash2Icon,
  Settings2Icon,
  AlertTriangleIcon,
} from "lucide-react";

export interface WriterEngineProps {
  videoId: string;
  fieldId: WriterFieldId;
  modes: Mode[];
  initialDocument?: string;
  layout: "fullscreen" | "modal";
  context: WriterContext;
  onDocumentChange?: (document: string) => void;
  view?: WriterView;
  onViewChange?: (view: WriterView) => void;
  ctxTab?: string;
  onCtxTabChange?: (tab: string) => void;
  onCancel?: () => void;
  /**
   * Persist the final (image-uploaded) document. Resolve only once the save
   * is confirmed, reject if it failed: local images go only after it resolves.
   */
  onApply: (finalDocument: string) => Promise<void>;
  /** The applied document is saved: the host closes the writer here. */
  onApplied?: (finalDocument: string) => void;
  /** When set, the modal's Repo Files tab shows an "add from clipboard" button. */
  onAddFileFromClipboard?: () => void;
  /** Other fields on the same page, offered as toggleable AI context. */
  pageFields?: Array<{ id: string; label: string; value: string }>;
}

export function WriterEngine({
  videoId,
  fieldId,
  modes,
  initialDocument,
  layout,
  context,
  onDocumentChange,
  view = "writer",
  onViewChange,
  ctxTab,
  onCtxTabChange,
  onCancel,
  onApply,
  onApplied,
  onAddFileFromClipboard,
  pageFields,
}: WriterEngineProps) {
  const { chapters, indexedClips, courseStructure, fullPath, isStandalone } =
    context;

  const { mode: constrainedMode } = constrainModes(
    modes,
    defaultModeForRole(context.videoRole)
  );
  const [mode, setMode] = useState<Mode>(constrainedMode);
  const [model, setModel] = useArticleWriterModel();
  const ctxModel = useContextModel(context, pageFields);
  useMemoryAutosave(ctxModel.memoryText, context.repoId);

  const [isCopied, setIsCopied] = useState(false);

  const isDocumentMode =
    mode === "article" ||
    mode === "skill-building" ||
    mode === "newsletter" ||
    mode === "seo-description-document";

  const [initialMessages] = useState(
    () => loadFieldMessages(videoId, fieldId, mode) as DocumentAgentMessage[]
  );

  const chatApi = isDocumentMode
    ? `/videos/${videoId}/document-completions`
    : `/videos/${videoId}/completions`;

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    addToolOutput,
    stop,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({ api: chatApi }),
    messages: initialMessages,
  });

  const isGenerating = status === "streaming" || status === "submitted";

  const wrappedAddToolOutput: typeof addToolOutput = useCallback(
    async (args) => {
      await addToolOutput(args);
    },
    [addToolOutput]
  );

  // The document is seeded from — and only from — the persisted value handed
  // down by the host's route loader. It is never written to localStorage: a
  // stored draft would shadow the loader and could be applied over a newer
  // value. Only the conversation survives a reload.
  const { document, documentRef, resetDocument, updateDocument } =
    useDocumentFlow({
      initialDocument,
      mode,
      isDocumentMode,
      messages,
      status,
      addToolOutput: wrappedAddToolOutput,
      onDocumentChange,
    });

  const { docScreenshotRuntime, isCapturing } = useDocScreenshotRuntime({
    videoId,
    indexedClips,
    isGenerating,
    documentRef,
    updateDocument,
  });

  const hasScreenshots = indexedClips.length > 0 && isDocumentMode;

  const docExtraComponents = hasScreenshots
    ? PREVIEW_COMPONENTS_WITH_SCREENSHOTS
    : PREVIEW_COMPONENTS;

  const previewOptions = useMemo(
    (): DocumentPreviewOptions => ({ screenshots: hasScreenshots }),
    [hasScreenshots]
  );

  const docPreprocessMarkdown = useMemo(
    () => (md: string) => preprocessDocumentPreview(md, previewOptions),
    [previewOptions]
  );

  const handleRemoveDocBlock = useRemoveDocumentBlock({
    documentRef,
    updateDocument,
    isGenerating,
    previewOptions,
  });

  const docQuizRuntime = useMemo(
    (): QuizRuntime => ({
      // Mid-stream the next chunk would overwrite the cut, so the card's X waits.
      onRemoveQuestion: isGenerating
        ? undefined
        : (questionStart: number) => {
            const currentDoc = documentRef.current;
            if (currentDoc)
              updateDocument(removeQuizQuestion(currentDoc, questionStart));
          },
    }),
    [documentRef, updateDocument, isGenerating]
  );

  // Persist messages on stream completion
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const transitionedToReady =
      prevStatusRef.current === "streaming" && status === "ready";
    prevStatusRef.current = status;

    if (transitionedToReady) {
      saveFieldMessages(videoId, fieldId, mode, messages);
      return;
    }

    if (isDocumentMode && status === "ready" && messages.length > 0) {
      saveFieldMessages(videoId, fieldId, mode, messages);
    }
  }, [status, videoId, fieldId, mode, messages, isDocumentMode]);

  const handleModeChange = (newMode: Mode) => {
    if (modes.length > 0 && !modes.includes(newMode)) return;
    if (messages.length > 0) {
      saveFieldMessages(videoId, fieldId, mode, messages);
    }
    setMode(newMode);
    setMessages(
      loadFieldMessages(videoId, fieldId, newMode) as DocumentAgentMessage[]
    );
  };

  const getBodyPayload = useCallback(() => {
    const transcriptEnabled =
      chapters.length > 0
        ? ctxModel.enabledSections.size > 0
        : ctxModel.includeTranscript;
    const enabledPageFields = (pageFields ?? [])
      .filter((f) => ctxModel.enabledFields.has(f.id))
      .map((f) => ({ label: f.label, value: f.value }));
    const base = {
      enabledFiles: Array.from(ctxModel.enabledFiles),
      includeTranscript: transcriptEnabled,
      enabledSections: Array.from(ctxModel.enabledSections),
      includeDiagramText: ctxModel.diagramTextEnabled,
      courseStructure:
        ctxModel.includeCourseStructure && courseStructure
          ? courseStructure
          : undefined,
      ...ctxModel.promptTexts,
      pageFields: enabledPageFields,
    };
    // Ref, not state: a lint fix sends in the same tick as it rewrites.
    return isDocumentMode
      ? { ...base, document: documentRef.current, mode, model }
      : { ...base, mode, model };
  }, [
    chapters.length,
    ctxModel.enabledSections,
    ctxModel.includeTranscript,
    ctxModel.diagramTextEnabled,
    ctxModel.enabledFiles,
    ctxModel.enabledFields,
    pageFields,
    ctxModel.includeCourseStructure,
    courseStructure,
    ctxModel.promptTexts,
    isDocumentMode,
    documentRef,
    mode,
    model,
  ]);

  const {
    phrases: bannedPhrases,
    addPhrase: addBannedPhrase,
    removePhrase: removeBannedPhrase,
  } = useBannedPhrases();

  const lastAssistantMessageText = partsToText(
    messages
      .slice()
      .reverse()
      .find((m) => m.role === "assistant")?.parts ?? []
  );

  const lintContext = useLintContext({
    courseQuizIds: context.quizIds,
    isStreaming: isGenerating,
  });

  const { violations } = useLint(
    isDocumentMode && document ? document : lastAssistantMessageText,
    mode,
    bannedPhrases,
    lintContext
  );

  const handleSend = useCallback(
    (text: string) => {
      // useChat reports a failed send through its status, not this promise.
      void sendMessage({ text }, { body: getBodyPayload() });
    },
    [sendMessage, getBodyPayload]
  );

  const {
    submit: handleSubmit,
    queuedMessages,
    clearQueue,
  } = useMessageQueue(status, handleSend, isCapturing);

  const handleClearChat = () => {
    setMessages([]);
    clearQueue();
    turnDispatch({ type: "chat-cleared" });
    saveFieldMessages(videoId, fieldId, mode, []);
    // Clearing the chat throws away the session's AI work; the document goes
    // back to the persisted value rather than blank.
    if (isDocumentMode) resetDocument();
  };

  const handleFixLintViolations = useLintFix({
    violations,
    isDocumentMode,
    documentRef,
    updateDocument,
    submitMessage: handleSubmit,
    context: lintContext,
  });

  const turn = useWriterTurn({
    messages,
    status,
    error,
    regenerate: () => void regenerate({ body: getBodyPayload() }),
    stop: () => void stop(),
  });
  const turnDispatch = turn.dispatch;
  const handleRegenerate = useCallback(
    () => turnDispatch({ type: "regenerate-requested" }),
    [turnDispatch]
  );

  // Links: add/remove hit the global link API; React Router auto-revalidates
  // the route loader afterward, which refreshes context.links.
  const addLinkFetcher = useFetcher();
  const deleteLinkFetcher = useFetcher();

  const handleAddLink = useCallback(
    (link: { url: string; title: string; description?: string }) => {
      addLinkFetcher.submit(
        {
          url: link.url,
          title: link.title,
          description: link.description ?? "",
        },
        { method: "post", action: "/api/links" }
      );
    },
    [addLinkFetcher]
  );

  const handleRemoveLink = useCallback(
    (id: string) => {
      deleteLinkFetcher.submit(null, {
        method: "post",
        action: `/api/links/${id}/delete`,
      });
    },
    [deleteLinkFetcher]
  );

  const { isApplying, handleApply } = useApplyDocument(
    videoId,
    documentRef,
    updateDocument,
    onApply,
    onApplied
  );

  const toolbarProps: WriteToolbarProps = useMemo(
    () => ({
      mode,
      status,
      isCopied,
      messagesLength: messages.length,
      violations,
      availableFolders: [] as const,
      foldersWithReadme: new Set<string>(),
      isStandalone,
      isDocumentMode,
      lastAssistantMessageText,
      writeToReadmeFetcherState: "idle" as const,
      hasUnresolvedScreenshots: hasUnresolvedScreenshots(document ?? ""),
      onModeChange: handleModeChange,
      onCopyToClipboard: () => {
        const text = isDocumentMode
          ? (document ?? "")
          : lastAssistantMessageText;
        navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      },
      onCopyAsRichText: () => {},
      onCopyConversationHistory: () => {},
      onGoLive: () => {},
      onFixLintViolations: handleFixLintViolations,
      onOpenBannedPhrases: () => {},
      onRegenerate: handleRegenerate,
      onClearChat: handleClearChat,
      onWriteToReadme: () => {},
    }),
    [
      mode,
      status,
      isCopied,
      messages.length,
      violations,
      isStandalone,
      isDocumentMode,
      lastAssistantMessageText,
      document,
      handleFixLintViolations,
      handleRegenerate,
    ]
  );

  const chatProps = useMemo(
    () => ({
      messages,
      setMessages,
      failure: turn.failure,
      onRetry: () => turnDispatch({ type: "retry-requested" }),
      onRegenerate: handleRegenerate,
      fullPath,
      onSubmit: handleSubmit,
      onStop: () => turnDispatch({ type: "stop-requested" }),
      status,
      indexedClips,
      mode,
      videoId,
      toolbarProps: layout === "modal" ? undefined : toolbarProps,
      queuedMessages,
      documentRef: isDocumentMode ? documentRef : undefined,
      updateDocument: isDocumentMode ? updateDocument : undefined,
    }),
    [
      messages,
      setMessages,
      turn.failure,
      turnDispatch,
      handleRegenerate,
      fullPath,
      handleSubmit,
      status,
      indexedClips,
      mode,
      videoId,
      layout,
      toolbarProps,
      queuedMessages,
      isDocumentMode,
      documentRef,
      updateDocument,
    ]
  );

  if (layout === "modal") {
    const lintCount = violations.reduce((sum, v) => sum + v.count, 0);
    const unresolvedScreenshots = hasUnresolvedScreenshots(document ?? "");
    return (
      <div className="relative flex flex-1 flex-col overflow-hidden h-full">
        {/* 2-pane body */}
        <div className="flex flex-1 overflow-hidden">
          <WriteChat {...chatProps} className="w-2/5 border-r" />
          <div className="flex-1 flex flex-col">
            <InlineContextStrip
              sources={ctxModel.sources}
              totalTokens={ctxModel.totalTokens}
              onToggleSource={ctxModel.toggleSource}
              onToggleItem={ctxModel.toggleItem}
              onOpenPanel={() => onViewChange?.("context")}
            />
            <ChooseScreenshotProvider runtime={docScreenshotRuntime}>
              <QuizProvider runtime={docQuizRuntime}>
                <DocumentPanel
                  variant="modal"
                  document={document}
                  fullPath={fullPath}
                  extraComponents={docExtraComponents}
                  preprocessMarkdown={docPreprocessMarkdown}
                  onRemoveBlock={handleRemoveDocBlock}
                  onDocumentChange={updateDocument}
                  readOnly={isGenerating}
                />
              </QuizProvider>
            </ChooseScreenshotProvider>
          </div>
        </div>

        {/* Context overlay */}
        {view === "context" && (
          <ContextView
            sources={ctxModel.sources}
            totalTokens={ctxModel.totalTokens}
            activeKey={ctxTab ?? ctxModel.sources[0]?.key ?? "transcript"}
            onTab={(tab) => onCtxTabChange?.(tab)}
            onBack={() => onViewChange?.("writer")}
            onToggleItem={ctxModel.toggleItem}
            onToggleSource={ctxModel.toggleSource}
            onSetSourceEnabled={ctxModel.setSourceEnabled}
            memoryText={ctxModel.memoryText}
            onMemoryChange={ctxModel.setMemoryText}
            links={ctxModel.links}
            onAddLink={handleAddLink}
            onRemoveLink={handleRemoveLink}
            onAddFileFromClipboard={onAddFileFromClipboard}
          />
        )}

        {/* Settings overlay */}
        {view === "settings" && (
          <SettingsView
            banned={bannedPhrases.map((p) => p.readable)}
            onAddPhrase={(s) => addBannedPhrase(s, s, false)}
            onRemovePhrase={removeBannedPhrase}
            onBack={() => onViewChange?.("writer")}
          />
        )}

        {/* Bottom bar — hidden when overlays are open */}
        {view === "writer" && (
          <div className="flex flex-none items-center gap-2 border-t bg-background px-3 py-2">
            <WriteModeDropdown
              mode={mode}
              onModeChange={handleModeChange}
              allowedModes={modes}
            />
            <WriteModelSelector
              model={model}
              onModelChange={setModel}
              disabled={isGenerating}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={handleRegenerate}
              disabled={isGenerating || messages.length === 0}
              title="Regenerate"
            >
              <RefreshCwIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={handleClearChat}
              disabled={isGenerating || messages.length === 0}
              title="Clear chat"
            >
              <Trash2Icon className="size-4" />
            </Button>
            {lintCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={handleFixLintViolations}
              >
                <AlertTriangleIcon className="size-4 mr-1 text-orange-500" />
                Fix ({lintCount})
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onViewChange?.("settings")}
              title="Settings"
            >
              <Settings2Icon className="size-4" />
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isApplying}
            >
              Cancel
            </Button>
            <ApplyButton
              onApply={handleApply}
              isApplying={isApplying}
              isGenerating={isGenerating}
              unresolvedScreenshots={unresolvedScreenshots}
              lintCount={lintCount}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {isDocumentMode ? (
        <>
          <WriteChat {...chatProps} className="w-2/5" />
          <div className="w-3/5 flex flex-col border-l">
            <ChooseScreenshotProvider runtime={docScreenshotRuntime}>
              <QuizProvider runtime={docQuizRuntime}>
                <DocumentPanel
                  document={document}
                  fullPath={fullPath}
                  extraComponents={docExtraComponents}
                  preprocessMarkdown={docPreprocessMarkdown}
                  onRemoveBlock={handleRemoveDocBlock}
                  onDocumentChange={updateDocument}
                  violations={violations}
                  onFixLintViolations={handleFixLintViolations}
                  readOnly={isGenerating}
                />
              </QuizProvider>
            </ChooseScreenshotProvider>
          </div>
        </>
      ) : (
        <WriteChat {...chatProps} />
      )}
    </div>
  );
}
