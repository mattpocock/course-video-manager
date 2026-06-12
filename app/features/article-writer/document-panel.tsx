import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import { MarkdownMonacoEditor } from "@/components/markdown-monaco-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CopyIcon,
  SaveIcon,
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  FileTextIcon,
  FileTypeIcon,
  PlusIcon,
  PencilIcon,
  EyeIcon,
  AlertTriangleIcon,
  ClipboardPasteIcon,
} from "lucide-react";
import type { LintViolation } from "./lint-rules";
import type { Options } from "react-markdown";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

export interface DocumentPanelProps {
  document: string | undefined;
  fullPath: string;
  extraComponents?: Options["components"];
  preprocessMarkdown?: (md: string) => string;
  onDocumentChange?: (content: string) => void;
  isCopied?: boolean;
  isUploadingForCopy?: boolean;
  onCopyAsMarkdown?: () => void;
  onCopyAsRichText?: () => void;
  isStandalone?: boolean;
  availableFolders?: readonly ("explainer" | "problem" | "solution")[];
  foldersWithReadme?: Set<string>;
  writeToReadmeFetcherState?: "idle" | "submitting" | "loading";
  hasUnresolvedScreenshots?: boolean;
  onWriteToReadme?: (
    mode: "write" | "append",
    targetFolder: "explainer" | "problem" | "solution"
  ) => void;
  isUploadingImages?: boolean;
  onUploadImages?: () => void;
  violations?: LintViolation[];
  onFixLintViolations?: () => void;
  sessionTimer?: React.ReactNode;
}

export const DocumentPanel = memo(function DocumentPanel({
  document,
  fullPath,
  extraComponents,
  preprocessMarkdown,
  onDocumentChange,
  isCopied,
  isUploadingForCopy,
  onCopyAsMarkdown,
  onCopyAsRichText,
  isStandalone,
  availableFolders = [],
  foldersWithReadme = new Set<string>(),
  writeToReadmeFetcherState,
  hasUnresolvedScreenshots,
  onWriteToReadme,
  isUploadingImages,
  onUploadImages,
  violations,
  onFixLintViolations,
  sessionTimer,
}: DocumentPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  // Scroll position preservation between edit/preview
  const scrollFractionRef = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleToggleEditing = useCallback(() => {
    // Capture scroll fraction from the outgoing view
    if (isEditing) {
      // Leaving edit mode → capture Monaco scroll fraction
      const editor = editorRef.current;
      if (editor) {
        const scrollTop = editor.getScrollTop();
        const scrollHeight = editor.getScrollHeight();
        const clientHeight = editor.getLayoutInfo().height;
        const maxScroll = scrollHeight - clientHeight;
        scrollFractionRef.current = maxScroll > 0 ? scrollTop / maxScroll : 0;
      }
    } else {
      // Leaving preview mode → capture preview div scroll fraction
      const el = previewRef.current;
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        scrollFractionRef.current =
          maxScroll > 0 ? el.scrollTop / maxScroll : 0;
      }
    }
    setIsEditing(!isEditing);
  }, [isEditing]);

  // Apply scroll fraction to preview div after switching to preview
  useEffect(() => {
    if (!isEditing && previewRef.current) {
      const el = previewRef.current;
      const maxScroll = el.scrollHeight - el.clientHeight;
      el.scrollTop = maxScroll * scrollFractionRef.current;
    }
  }, [isEditing]);

  const handleEditorMount = useCallback<OnMount>((editor) => {
    // Apply saved scroll fraction after Monaco lays out
    requestAnimationFrame(() => {
      const scrollHeight = editor.getScrollHeight();
      const clientHeight = editor.getLayoutInfo().height;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll > 0) {
        editor.setScrollTop(maxScroll * scrollFractionRef.current);
      }
    });
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onDocumentChange?.(text);
      }
    } catch {
      // Clipboard access denied or empty
    }
  }, [onDocumentChange]);

  if (!document) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <p>No document yet. Send a message to generate one.</p>
        {onDocumentChange && (
          <Button
            variant="outline"
            size="sm"
            onClick={handlePasteFromClipboard}
          >
            <ClipboardPasteIcon className="h-4 w-4 mr-2" />
            Paste from Clipboard
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-4 py-2 border-b">
        {/* Copy dropdown */}
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={
                      !document ||
                      hasUnresolvedScreenshots ||
                      isUploadingForCopy
                    }
                  >
                    {isUploadingForCopy ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : isCopied ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <CopyIcon className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isUploadingForCopy
                    ? "Uploading images..."
                    : isCopied
                      ? "Copied"
                      : "Copy document"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onCopyAsMarkdown}>
              <FileTextIcon className="h-4 w-4 mr-2" />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyAsRichText}>
              <FileTypeIcon className="h-4 w-4 mr-2" />
              Copy as Rich Text
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Readme dropdown */}
        {!isStandalone && onWriteToReadme && (
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={
                        !document ||
                        hasUnresolvedScreenshots ||
                        writeToReadmeFetcherState === "submitting" ||
                        writeToReadmeFetcherState === "loading"
                      }
                    >
                      {writeToReadmeFetcherState === "submitting" ||
                      writeToReadmeFetcherState === "loading" ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SaveIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Save to README</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent>
              {availableFolders.map((folder, index) => (
                <div key={folder}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={() => onWriteToReadme("write", folder)}
                  >
                    <SaveIcon className="h-4 w-4 mr-2" />
                    Write to {folder}/readme.md
                  </DropdownMenuItem>
                  {foldersWithReadme.has(folder) && (
                    <DropdownMenuItem
                      onSelect={() => onWriteToReadme("append", folder)}
                    >
                      <PlusIcon className="h-4 w-4 mr-2" />
                      Append to {folder}/readme.md
                    </DropdownMenuItem>
                  )}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Upload images to Cloudinary */}
        {onUploadImages && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onUploadImages}
                  disabled={isUploadingImages || !document?.trim()}
                >
                  {isUploadingImages ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isUploadingImages
                    ? "Uploading images..."
                    : "Upload images to Cloudinary"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Lint violations */}
        {violations && violations.length > 0 && onFixLintViolations && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={onFixLintViolations}
                >
                  <AlertTriangleIcon className="h-4 w-4 mr-1 text-orange-500" />
                  Fix ({violations.reduce((sum, v) => sum + v.count, 0)})
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p className="font-semibold">Lint Violations:</p>
                  {violations.map((v) => (
                    <p key={v.rule.id} className="text-sm">
                      • {v.rule.name}: {v.count} issue
                      {v.count > 1 ? "s" : ""}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <div className="flex-1" />

        {/* Session timer */}
        {sessionTimer}

        {/* Edit / Preview toggle */}
        <Button variant="ghost" size="sm" onClick={handleToggleEditing}>
          {isEditing ? (
            <>
              <EyeIcon className="h-4 w-4 mr-1" />
              Preview
            </>
          ) : (
            <>
              <PencilIcon className="h-4 w-4 mr-1" />
              Edit
            </>
          )}
        </Button>
      </div>
      {isEditing ? (
        <MarkdownMonacoEditor
          value={document}
          onChange={(value) => onDocumentChange?.(value)}
          onSave={(value) => onDocumentChangeRef.current?.(value)}
          editorRef={editorRef}
          onMount={handleEditorMount}
          options={{
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: true,
          }}
          fallback={
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Loading editor…
            </div>
          }
        />
      ) : (
        <div
          ref={previewRef}
          className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground p-6"
        >
          <div className="max-w-[75ch] mx-auto">
            <AIResponse
              imageBasePath={fullPath}
              extraComponents={extraComponents}
              preprocessMarkdown={preprocessMarkdown}
            >
              {document}
            </AIResponse>
          </div>
        </div>
      )}
    </div>
  );
});
