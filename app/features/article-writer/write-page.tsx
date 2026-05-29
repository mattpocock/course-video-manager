"use client";

import type {
  SectionWithWordCount,
  IndexedClip,
  Mode,
  Model,
} from "@/features/article-writer/types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { useFetcher, useBlocker, useRevalidator } from "react-router";
import { toast } from "sonner";
import type { Options } from "react-markdown";
import { VideoContextPanel } from "@/components/video-context-panel";
import { useLint } from "@/hooks/use-lint";
import { useBannedPhrases } from "@/hooks/use-banned-phrases";

import {
  partsToText,
  loadMessagesFromStorage,
  saveMessagesToStorage,
} from "./write-utils";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
  removeChooseScreenshot,
  hasUnresolvedScreenshots,
} from "./choose-screenshot-mutations";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import { ChooseScreenshot } from "./choose-screenshot";
import { WriteChat } from "./write-chat";
import { WriteModals } from "./write-modals";
import { DocumentPanel } from "./document-panel";
import { useDocumentFlow } from "./use-document-flow";
import { useVideoContextHandlers } from "./use-video-context-handlers";
import { useToolbarProps } from "./use-toolbar-props";
import { writePageReducer, createInitialState } from "./write-page-reducer";
import { useDocumentPanelActions } from "./use-document-panel-actions";
import { useMessageQueue } from "./use-message-queue";
import { SessionTimer } from "./use-session-timer";

export interface WritePageProps {
  videoId: string;
  loaderData: {
    lessonId: string | null;
    fullPath: string;
    files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
    isStandalone: boolean;
    transcript: string;
    transcriptWordCount: number;
    chapters: SectionWithWordCount[];
    indexedClips: IndexedClip[];
    links: Array<{ id: string; url: string; title: string }>;
    courseStructure: {
      repoName: string;
      currentSectionPath: string;
      currentLessonPath: string;
      sections: {
        path: string;
        lessons: { path: string }[];
      }[];
    } | null;
    nextLessonWithoutVideo: {
      lessonId: string;
      lessonPath: string;
      sectionPath: string;
      hasExplainerFolder: boolean;
    } | null;
    repoId: string | null;
    memory: string;
  };
}

export function WritePage({ videoId, loaderData }: WritePageProps) {
  const {
    lessonId,
    fullPath,
    files,
    isStandalone,
    transcript,
    transcriptWordCount,
    chapters,
    indexedClips,
    links,
    courseStructure,
    nextLessonWithoutVideo,
    repoId,
    memory: initialMemory,
  } = loaderData;

  const [state, dispatch] = useReducer(
    writePageReducer,
    { files, chapters, initialMemory },
    createInitialState
  );

  // When files arrive asynchronously (deferred from loader), sync enabledFiles.
  // Only fires once: when files go from empty (initial deferred state) to populated.
  const prevFilesLengthRef = useRef(files.length);
  useEffect(() => {
    if (prevFilesLengthRef.current === 0 && files.length > 0) {
      dispatch({ type: "files-loaded", files });
    }
    prevFilesLengthRef.current = files.length;
  }, [files]);

  const {
    mode,
    model,
    enabledFiles,
    includeTranscript,
    enabledSections,
    includeCourseStructure,
    memory,
    memoryEnabled,
    docCapturingKey,
    isCopied,
    isAddVideoToNextLessonModalOpen,
    isFileModalOpen,
    selectedFilename,
    selectedFileContent,
    isPasteModalOpen,
    isDeleteModalOpen,
    fileToDelete,
    isLessonPasteModalOpen,
    isPreviewModalOpen,
    previewFilePath,
    isBannedPhrasesModalOpen,
    isAddLinkModalOpen,
  } = state;

  const memorySaveTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const isMemoryInitialMount = useRef(true);
  const updateMemoryFetcher = useFetcher();

  useEffect(() => {
    if (isMemoryInitialMount.current) {
      isMemoryInitialMount.current = false;
      return;
    }
    if (!repoId) return;
    if (memorySaveTimeoutRef.current) {
      clearTimeout(memorySaveTimeoutRef.current);
    }
    memorySaveTimeoutRef.current = setTimeout(() => {
      updateMemoryFetcher.submit(
        { memory },
        { method: "post", action: `/api/courses/${repoId}/update-memory` }
      );
    }, 750);
    return () => {
      if (memorySaveTimeoutRef.current) {
        clearTimeout(memorySaveTimeoutRef.current);
      }
    };
  }, [memory, repoId]);

  const isDocumentMode =
    mode === "article" || mode === "skill-building" || mode === "newsletter";

  const availableFolders = ["explainer", "problem", "solution"] as const;

  const foldersWithReadme = useMemo(
    () =>
      new Set(
        availableFolders.filter((folder) =>
          files.some((f) => f.path.toLowerCase() === `${folder}/readme.md`)
        )
      ),
    [files]
  );

  const [initialMessages] = useState(() =>
    loadMessagesFromStorage(videoId, mode)
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
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({ api: chatApi }),
    messages: initialMessages,
  });

  const isGenerating = status === "streaming" || status === "submitted";

  const blocker = useBlocker(isGenerating);

  useEffect(() => {
    if (blocker.state === "blocked") {
      toast.warning("Cannot navigate while document is generating");
      blocker.reset();
    }
  }, [blocker]);

  const { document, documentRef, clearDocument, saveDocument, updateDocument } =
    useDocumentFlow({
      videoId,
      mode,
      isDocumentMode,
      messages,
      status,
      addToolOutput,
    });

  // ChooseScreenshot support for document panel
  const handleDocCapture = useCallback(
    async (
      clipIndex: number,
      alt: string,
      timestamp: number,
      videoFilename: string
    ) => {
      const key = `doc-${clipIndex}-${alt}`;
      dispatch({ type: "set-doc-capturing-key", key });
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestamp, videoFilename }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        const currentDoc = documentRef.current;
        if (currentDoc) {
          updateDocument(
            replaceChooseScreenshotWithImage(
              currentDoc,
              clipIndex,
              alt,
              imagePath
            )
          );
        }
      } catch (err) {
        console.error("Screenshot capture failed:", err);
      } finally {
        dispatch({ type: "set-doc-capturing-key", key: null });
      }
    },
    [videoId, documentRef, updateDocument]
  );

  const handleDocClipIndexChange = useCallback(
    (currentIndex: number, newIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          updateChooseScreenshotClipIndex(
            currentDoc,
            currentIndex,
            newIndex,
            alt
          )
        );
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocRemove = useCallback(
    (clipIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(removeChooseScreenshot(currentDoc, clipIndex, alt));
      }
    },
    [documentRef, updateDocument]
  );

  const revalidator = useRevalidator();

  const {
    isWritingToReadme,
    isUploadingImages,
    isUploadingForCopy,
    handleUploadImages,
    handleCopyAsMarkdown: handleDocCopyAsMarkdown,
    handleCopyAsRichText: handleDocCopyAsRichText,
    handleWriteToReadme: handleDocWriteToReadme,
  } = useDocumentPanelActions({
    videoId,
    documentRef,
    updateDocument,
    lessonId,
    setIsCopied: (v: boolean) => dispatch({ type: "set-is-copied", value: v }),
    revalidate: revalidator.revalidate,
  });

  const docExtraComponents = useMemo((): Options["components"] | undefined => {
    if (indexedClips.length === 0 || !isDocumentMode) return undefined;
    return {
      choosescreenshot: ((
        compProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
      ) => {
        const clipIdx = parseInt(compProps.clipindex as string, 10);
        const altText = (compProps.alt as string) ?? "";
        const key = `doc-${clipIdx}-${altText}`;
        return (
          <ChooseScreenshot
            clipIndex={clipIdx}
            alt={altText}
            clips={indexedClips}
            onClipIndexChange={(current, next) =>
              handleDocClipIndexChange(current, next, altText)
            }
            onCapture={handleDocCapture}
            onRemove={handleDocRemove}
            isCapturing={docCapturingKey === key}
            isStreaming={status === "streaming" || status === "submitted"}
          />
        );
      }) as unknown,
    } as Options["components"];
  }, [
    indexedClips,
    isDocumentMode,
    handleDocClipIndexChange,
    handleDocCapture,
    handleDocRemove,
    docCapturingKey,
    status,
  ]);

  const docPreprocessMarkdown = useMemo(() => {
    if (!docExtraComponents) return undefined;
    return (md: string) => preprocessChooseScreenshotMarkdown(md);
  }, [docExtraComponents]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const transitionedToReady =
      prevStatusRef.current === "streaming" && status === "ready";
    prevStatusRef.current = status;

    if (transitionedToReady) {
      saveMessagesToStorage(videoId, mode, messages);
      if (isDocumentMode) saveDocument();
      return;
    }

    // In document mode, tool outputs are added client-side via addToolOutput()
    // after streaming completes. Save messages when they change while already
    // ready so tool results persist across page refreshes.
    if (isDocumentMode && status === "ready" && messages.length > 0) {
      saveMessagesToStorage(videoId, mode, messages);
    }
  }, [status, videoId, mode, messages, isDocumentMode, saveDocument]);

  const handleModeChange = (newMode: Mode) => {
    if (messages.length > 0) {
      saveMessagesToStorage(videoId, mode, messages);
    }
    dispatch({ type: "set-mode", mode: newMode });
    setMessages(loadMessagesFromStorage(videoId, newMode));
    if (newMode === "style-guide-skill-building") {
      dispatch({
        type: "set-enabled-files",
        files: new Set(
          files
            .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
            .map((f) => f.path)
        ),
      });
    }
    if (
      (newMode === "scoping-discussion" || newMode === "scoping-document") &&
      courseStructure
    ) {
      dispatch({ type: "set-include-course-structure", value: true });
    }
  };

  const handleModelChange = (newModel: Model) => {
    dispatch({ type: "set-model", model: newModel });
  };

  const handleClearChat = () => {
    setMessages([]);
    clearQueue();
    saveMessagesToStorage(videoId, mode, []);
    if (isDocumentMode) clearDocument();
  };

  const getBodyPayload = useCallback(() => {
    const transcriptEnabled =
      chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;
    const base = {
      enabledFiles: Array.from(enabledFiles),
      model,
      includeTranscript: transcriptEnabled,
      enabledSections: Array.from(enabledSections),
      courseStructure:
        includeCourseStructure && courseStructure ? courseStructure : undefined,
      memory: memoryEnabled && memory ? memory : undefined,
    };
    return isDocumentMode ? { ...base, document, mode } : { ...base, mode };
  }, [
    chapters.length,
    enabledSections,
    includeTranscript,
    enabledFiles,
    model,
    includeCourseStructure,
    courseStructure,
    memoryEnabled,
    memory,
    isDocumentMode,
    document,
    mode,
  ]);

  const writeToReadmeFetcher = useFetcher();
  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  const {
    phrases: bannedPhrases,
    addPhrase: addBannedPhrase,
    removePhrase: removeBannedPhrase,
    updatePhrase: updateBannedPhrase,
    resetToDefaults: resetBannedPhrases,
  } = useBannedPhrases();

  const {
    handleCopyTranscript,
    handleIncludeCourseStructureChange,
    handleFileClick,
    handleOpenFolderClick,
    handleAddFromClipboardClick,
    handleDeleteFile,
    handleDeleteLink,
    handleAddLinkClick,
    handleMemoryEnabledChange,
    handleEditFile,
  } = useVideoContextHandlers({
    videoId,
    transcript,
    isStandalone,
    openFolderFetcher,
    deleteLinkFetcher,
    dispatch,
  });

  const lastAssistantMessageText = partsToText(
    messages
      .slice()
      .reverse()
      .find((m) => m.role === "assistant")?.parts ?? []
  );

  const { violations, composeFixMessage } = useLint(
    isDocumentMode && document ? document : lastAssistantMessageText,
    mode,
    bannedPhrases
  );

  const handleSend = useCallback(
    (text: string) => {
      sendMessage({ text }, { body: getBodyPayload() });
    },
    [sendMessage, getBodyPayload]
  );

  const {
    submit: handleSubmit,
    queuedMessages,
    clearQueue,
  } = useMessageQueue(status, handleSend);

  const handleGoLive = () => {
    dispatch({ type: "set-mode", mode: "interview" });
    const transcriptEnabled =
      chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;
    sendMessage(
      {
        text: "Let's go live! Start the interview based on what we discussed.",
      },
      {
        body: {
          enabledFiles: Array.from(enabledFiles),
          mode: "interview",
          model,
          includeTranscript: transcriptEnabled,
          enabledSections: Array.from(enabledSections),
          courseStructure:
            includeCourseStructure && courseStructure
              ? courseStructure
              : undefined,
        },
      }
    );
  };

  const toolbarProps = useToolbarProps({
    messages,
    mode,
    model,
    status,
    isCopied,
    setIsCopied: (v: boolean) => dispatch({ type: "set-is-copied", value: v }),
    violations,
    availableFolders,
    foldersWithReadme,
    isStandalone,
    isDocumentMode,
    document,
    writeToReadmeFetcher,
    lessonId,
    composeFixMessage,
    sendMessage,
    getBodyPayload,
    regenerate,
    onModeChange: handleModeChange,
    onModelChange: handleModelChange,
    onGoLive: handleGoLive,
    onClearChat: handleClearChat,
    onOpenBannedPhrases: () =>
      dispatch({ type: "set-banned-phrases-modal-open", value: true }),
  });

  const chatProps = useMemo(
    () => ({
      messages,
      setMessages,
      error,
      fullPath,
      onSubmit: handleSubmit,
      status,
      indexedClips,
      mode,
      videoId,
      toolbarProps,
      queuedMessages,
      documentRef: isDocumentMode ? documentRef : undefined,
      updateDocument: isDocumentMode ? updateDocument : undefined,
    }),
    [
      messages,
      setMessages,
      error,
      fullPath,
      handleSubmit,
      status,
      indexedClips,
      mode,
      videoId,
      toolbarProps,
      queuedMessages,
      isDocumentMode,
      documentRef,
      updateDocument,
    ]
  );

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          onCopyTranscript={handleCopyTranscript}
          chapters={chapters}
          enabledSections={enabledSections}
          onEnabledSectionsChange={(sections: Set<string>) =>
            dispatch({ type: "set-enabled-sections", sections })
          }
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={(value: boolean) =>
            dispatch({ type: "set-include-transcript", value })
          }
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          onIncludeCourseStructureChange={handleIncludeCourseStructureChange}
          files={files}
          isStandalone={isStandalone}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={(files: Set<string>) =>
            dispatch({ type: "set-enabled-files", files })
          }
          onFileClick={handleFileClick}
          onOpenFolderClick={handleOpenFolderClick}
          onAddFromClipboardClick={handleAddFromClipboardClick}
          onEditFile={handleEditFile}
          onDeleteFile={handleDeleteFile}
          links={links}
          onAddLinkClick={handleAddLinkClick}
          onDeleteLink={handleDeleteLink}
          memory={repoId ? memory : undefined}
          onMemoryChange={
            repoId
              ? (m: string) => dispatch({ type: "set-memory", memory: m })
              : undefined
          }
          memoryEnabled={memoryEnabled}
          onMemoryEnabledChange={handleMemoryEnabledChange}
        />
        {isDocumentMode ? (
          <>
            <WriteChat {...chatProps} className="w-2/5" />
            <div className="w-3/5 flex flex-col border-l">
              <DocumentPanel
                document={document}
                fullPath={fullPath}
                extraComponents={docExtraComponents}
                preprocessMarkdown={docPreprocessMarkdown}
                onDocumentChange={updateDocument}
                isCopied={isCopied}
                isUploadingForCopy={isUploadingForCopy}
                onCopyAsMarkdown={handleDocCopyAsMarkdown}
                onCopyAsRichText={handleDocCopyAsRichText}
                isStandalone={isStandalone}
                availableFolders={availableFolders}
                foldersWithReadme={foldersWithReadme}
                writeToReadmeFetcherState={
                  isWritingToReadme ? "submitting" : "idle"
                }
                hasUnresolvedScreenshots={hasUnresolvedScreenshots(
                  document ?? ""
                )}
                onWriteToReadme={handleDocWriteToReadme}
                isUploadingImages={isUploadingImages}
                onUploadImages={handleUploadImages}
                violations={violations}
                onFixLintViolations={toolbarProps.onFixLintViolations}
                isStreaming={status === "streaming"}
                sessionTimer={<SessionTimer videoId={videoId} mode={mode} />}
              />
            </div>
          </>
        ) : (
          <WriteChat {...chatProps} />
        )}
      </div>
      <WriteModals
        videoId={videoId}
        isStandalone={isStandalone}
        defaultTextFilename={`${mode}.md`}
        files={files}
        selectedFilename={selectedFilename}
        selectedFileContent={selectedFileContent}
        isFileModalOpen={isFileModalOpen}
        onFileModalClose={(open) => {
          dispatch(
            open
              ? {
                  type: "open-file-modal",
                  filename: selectedFilename,
                  content: selectedFileContent,
                }
              : { type: "close-file-modal" }
          );
          if (!open) revalidator.revalidate();
        }}
        isPasteModalOpen={isPasteModalOpen}
        onPasteModalClose={(open) => {
          dispatch({ type: "set-paste-modal-open", value: open });
          if (!open) revalidator.revalidate();
        }}
        onStandaloneFileCreated={(filename) =>
          dispatch({ type: "add-enabled-file", filename })
        }
        isDeleteModalOpen={isDeleteModalOpen}
        fileToDelete={fileToDelete}
        onDeleteModalClose={(open) => {
          dispatch(
            open
              ? { type: "open-delete-modal", filename: fileToDelete }
              : { type: "close-delete-modal" }
          );
          if (!open) revalidator.revalidate();
        }}
        isLessonPasteModalOpen={isLessonPasteModalOpen}
        onLessonPasteModalClose={(open) => {
          dispatch({ type: "set-lesson-paste-modal-open", value: open });
          if (!open) revalidator.revalidate();
        }}
        onLessonFileCreated={(filename) =>
          dispatch({ type: "add-enabled-file", filename })
        }
        isPreviewModalOpen={isPreviewModalOpen}
        previewFilePath={previewFilePath}
        onPreviewModalClose={() => dispatch({ type: "close-preview-modal" })}
        isBannedPhrasesModalOpen={isBannedPhrasesModalOpen}
        onBannedPhrasesModalOpenChange={(open) =>
          dispatch({ type: "set-banned-phrases-modal-open", value: open })
        }
        bannedPhrases={bannedPhrases}
        onAddBannedPhrase={addBannedPhrase}
        onRemoveBannedPhrase={removeBannedPhrase}
        onUpdateBannedPhrase={updateBannedPhrase}
        onResetBannedPhrases={resetBannedPhrases}
        isAddLinkModalOpen={isAddLinkModalOpen}
        onAddLinkModalOpenChange={(open) =>
          dispatch({ type: "set-add-link-modal-open", value: open })
        }
        nextLessonWithoutVideo={nextLessonWithoutVideo}
        isAddVideoToNextLessonModalOpen={isAddVideoToNextLessonModalOpen}
        onAddVideoToNextLessonModalOpenChange={(open) =>
          dispatch({ type: "set-add-video-modal-open", value: open })
        }
      />
    </>
  );
}
