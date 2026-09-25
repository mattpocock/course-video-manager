import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FileTree } from "@/components/FileTree";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseStringSet,
  useLocalStorage,
  useLocalStorageBoolean,
} from "@/hooks/use-local-storage";
import type { Clip, FrontendInsertionPoint } from "../clip-state-reducer";
import type { SuggestionState } from "../video-editor-context";

type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

const partsToText = (parts: UIMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      return "";
    })
    .join("");
};

/**
 * Gets the database clip ID to truncate the transcript after.
 * Returns undefined if we should use the full transcript (insertion at end)
 * or if there's no clip before the insertion point (insertion at start).
 */
const getClipIdToTruncateAfter = (
  clips: Clip[],
  insertionPoint: FrontendInsertionPoint
): string | undefined => {
  if (insertionPoint.type === "start") {
    return undefined;
  }

  if (insertionPoint.type === "end") {
    // Full transcript - no truncation needed
    return undefined;
  }

  if (insertionPoint.type === "after-clip") {
    const clip = clips.find(
      (c) =>
        c.frontendId === insertionPoint.frontendClipId &&
        c.type === "on-database"
    );
    return clip?.type === "on-database" ? clip.databaseId : undefined;
  }

  if (insertionPoint.type === "after-chapter") {
    // Find the last clip before this chapter
    // We need to iterate through clips and find the one just before the section
    // For now, return undefined to use full transcript (safe default)
    return undefined;
  }

  return undefined;
};

export type SuggestionsPanelProps = {
  videoId: string;
  lastTranscribedClipId: string | null;
  clips: Clip[];
  insertionPoint: FrontendInsertionPoint;
  files: FileMetadata[];
  onSuggestionStateChange?: (state: SuggestionState) => void;
};

const SUGGESTIONS_ENABLED_KEY = "suggestions-enabled";
// -v2: stored bare filenames no longer match now that paths are relative.
const SUGGESTIONS_ENABLED_FILES_KEY = "suggestions-enabled-files-v2";

export function SuggestionsPanel(props: SuggestionsPanelProps) {
  const [enabled, setEnabled] = useLocalStorageBoolean(
    SUGGESTIONS_ENABLED_KEY
  );

  // The files enabled by default stand in until the author picks their own.
  // Stored per video, and shared with the Write page.
  const defaultEnabledFiles = useMemo(
    () =>
      JSON.stringify(
        props.files.filter((f) => f.defaultEnabled).map((f) => f.path)
      ),
    [props.files]
  );
  const [storedEnabledFiles, setStoredEnabledFiles] = useLocalStorage(
    `${SUGGESTIONS_ENABLED_FILES_KEY}-${props.videoId}`,
    defaultEnabledFiles
  );
  const enabledFiles = useMemo(
    () => parseStringSet(storedEnabledFiles),
    [storedEnabledFiles]
  );

  const { messages, sendMessage, status, setMessages, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/videos/${props.videoId}/suggest-next-clip`,
    }),
  });

  const lastAssistantMessage = messages.find((m) => m.role === "assistant");
  const suggestionText = lastAssistantMessage
    ? partsToText(lastAssistantMessage.parts)
    : "";

  const isStreaming = status === "submitted" || status === "streaming";

  const triggerSuggestion = useCallback(() => {
    // Cancel any in-flight suggestion before starting a new one
    if (status === "streaming") {
      stop();
    }
    setMessages([]);
    // Get the clip ID to truncate after based on the current insertion point
    const truncateAfterClipId = getClipIdToTruncateAfter(
      props.clips,
      props.insertionPoint
    );
    sendMessage(
      { text: "Suggest what I should say next." },
      {
        body: {
          enabledFiles: Array.from(enabledFiles),
          truncateAfterClipId,
        },
      }
    );
  }, [
    sendMessage,
    setMessages,
    props.clips,
    props.insertionPoint,
    enabledFiles,
    status,
    stop,
  ]);

  // Track the previous lastTranscribedClipId to detect new transcriptions
  const lastTranscribedClipIdRef = useRef<string | null>(null);

  // Trigger suggestion when a new clip is transcribed and suggestions are enabled
  // The triggerSuggestion function handles cancellation of any in-flight request
  useEffect(() => {
    if (
      enabled &&
      props.lastTranscribedClipId &&
      props.lastTranscribedClipId !== lastTranscribedClipIdRef.current
    ) {
      triggerSuggestion();
    }
    lastTranscribedClipIdRef.current = props.lastTranscribedClipId;
  }, [enabled, props.lastTranscribedClipId, triggerSuggestion]);

  // Notify parent of suggestion state changes for inline display
  useEffect(() => {
    props.onSuggestionStateChange?.({
      suggestionText,
      isStreaming,
      enabled,
      error: error ?? null,
      triggerSuggestion,
    });
  }, [
    suggestionText,
    isStreaming,
    enabled,
    error,
    triggerSuggestion,
    props.onSuggestionStateChange,
  ]);

  const handleEnabledFilesChange = (files: Set<string>) => {
    setStoredEnabledFiles(JSON.stringify([...files]));
  };

  const [previewFilePath, setPreviewFilePath] = useState("");
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="suggestions-enabled"
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
        />
        <Label htmlFor="suggestions-enabled" className="cursor-pointer">
          Enable AI suggestions
        </Label>
      </div>

      {props.files.length > 0 && (
        <div className="border-t border-border pt-4">
          <FileTree
            files={props.files}
            enabledFiles={enabledFiles}
            onEnabledFilesChange={handleEnabledFilesChange}
            onFileClick={handleFileClick}
            disabled={!enabled}
          />
        </div>
      )}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={props.videoId}
        filePath={previewFilePath}
      />
    </div>
  );
}
