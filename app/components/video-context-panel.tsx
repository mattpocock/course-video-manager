"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { FileTree } from "@/components/FileTree";
import { StandaloneFileTree } from "@/components/StandaloneFileTree";
import {
  ClipboardIcon,
  CheckIcon,
  LinkIcon,
  ExternalLinkIcon,
  Trash2Icon,
  PlusIcon,
  FolderOpenIcon,
} from "lucide-react";
import { memo, useState } from "react";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

export type Link = {
  id: string;
  title: string;
  url: string;
  description?: string | null;
};

export type CourseStructure = {
  repoName: string;
  currentSectionPath: string;
  currentLessonPath: string;
  sections: {
    path: string;
    lessons: { path: string; description?: string }[];
  }[];
};

export type VideoContextPanelProps = {
  videoSrc: string;

  // Transcript and sections
  transcriptWordCount: number;
  chapters: SectionWithWordCount[];
  enabledSections: Set<string>;
  onEnabledSectionsChange: (sections: Set<string>) => void;
  includeTranscript: boolean;
  onIncludeTranscriptChange: (include: boolean) => void;

  // Course structure (only for lesson-connected videos)
  courseStructure?: CourseStructure | null;
  includeCourseStructure: boolean;
  onIncludeCourseStructureChange: (include: boolean) => void;

  // Files
  files: FileMetadata[];
  isStandalone: boolean;
  enabledFiles: Set<string>;
  onEnabledFilesChange: (files: Set<string>) => void;
  onFileClick?: (filePath: string) => void;
  onAddFromClipboardClick?: () => void;
  onOpenFolderClick?: () => void;
  onEditFile?: (filename: string) => void;
  onDeleteFile?: (filename: string) => void;

  // Links
  links: Link[];
  onAddLinkClick?: () => void;
  onDeleteLink?: (linkId: string) => void;

  // Video component slot (allows custom video player)
  videoSlot?: React.ReactNode;

  // Reveal video file in file system
  onRevealInFileSystem?: () => void;

  // Copy transcript
  onCopyTranscript?: () => void;

  // Memory
  memory?: string;
  onMemoryChange?: (memory: string) => void;
  memoryEnabled?: boolean;
  onMemoryEnabledChange?: (enabled: boolean) => void;
};

export const VideoContextPanel = memo(function VideoContextPanel({
  videoSrc,
  transcriptWordCount,
  chapters,
  enabledSections,
  onEnabledSectionsChange,
  includeTranscript,
  onIncludeTranscriptChange,
  courseStructure,
  includeCourseStructure,
  onIncludeCourseStructureChange,
  files,
  isStandalone,
  enabledFiles,
  onEnabledFilesChange,
  onFileClick,
  onAddFromClipboardClick,
  onOpenFolderClick,
  onEditFile,
  onDeleteFile,
  links,
  onAddLinkClick,
  onDeleteLink,
  videoSlot,
  onRevealInFileSystem,
  onCopyTranscript,
  memory,
  onMemoryChange,
  memoryEnabled,
  onMemoryEnabledChange,
}: VideoContextPanelProps) {
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"context" | "links" | "memory">(
    "context"
  );

  return (
    <div className="w-1/4 border-r flex flex-col overflow-hidden">
      <div className="p-4 pb-0">
        {videoSlot ?? (
          <video src={videoSrc} className="w-full" controls preload="none" />
        )}
        {onRevealInFileSystem && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-muted-foreground"
            onClick={onRevealInFileSystem}
          >
            <FolderOpenIcon className="h-3.5 w-3.5" />
            Reveal in File System
          </Button>
        )}
      </div>
      {/* Tab buttons */}
      <div className="flex gap-1 px-4 pt-2 pb-4">
        <button
          onClick={() => setSidebarTab("context")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded transition-colors",
            sidebarTab === "context"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Context
        </button>
        <button
          onClick={() => setSidebarTab("links")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded transition-colors",
            sidebarTab === "links"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Links
        </button>
        {onMemoryChange && (
          <button
            onClick={() => setSidebarTab("memory")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded transition-colors",
              sidebarTab === "memory"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Memory
          </button>
        )}
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-4 scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
        {sidebarTab === "context" && (
          <>
            <div className="flex items-center gap-2 py-1 px-2">
              <Checkbox
                id="include-transcript"
                checked={
                  chapters.length > 0
                    ? enabledSections.size === chapters.length
                      ? true
                      : enabledSections.size > 0
                        ? "indeterminate"
                        : false
                    : includeTranscript
                }
                onCheckedChange={(checked) => {
                  if (chapters.length > 0) {
                    if (checked) {
                      onEnabledSectionsChange(
                        new Set(chapters.map((s) => s.id))
                      );
                    } else {
                      onEnabledSectionsChange(new Set());
                    }
                  } else {
                    onIncludeTranscriptChange(!!checked);
                  }
                }}
              />
              <label
                htmlFor="include-transcript"
                className="text-sm flex-1 cursor-pointer"
              >
                Transcript
              </label>
              <span className="text-xs text-muted-foreground">
                ({transcriptWordCount.toLocaleString()} words)
              </span>
              {onCopyTranscript && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground p-0.5"
                  onClick={(e) => {
                    e.preventDefault();
                    onCopyTranscript();
                    setTranscriptCopied(true);
                    setTimeout(() => setTranscriptCopied(false), 2000);
                  }}
                >
                  {transcriptCopied ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : (
                    <ClipboardIcon className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            {/* Section checkboxes */}
            {chapters.length > 0 && (
              <div className="shrink-0">
                <ScrollArea className="h-48">
                  <div className="space-y-1 px-2">
                    {chapters.map((section) => (
                      <div
                        key={section.id}
                        className="flex items-center gap-2 py-1 pl-6"
                      >
                        <Checkbox
                          id={`section-${section.id}`}
                          checked={enabledSections.has(section.id)}
                          onCheckedChange={(checked) => {
                            const newSet = new Set(enabledSections);
                            if (checked) {
                              newSet.add(section.id);
                            } else {
                              newSet.delete(section.id);
                            }
                            onEnabledSectionsChange(newSet);
                          }}
                        />
                        <label
                          htmlFor={`section-${section.id}`}
                          className="text-sm flex-1 cursor-pointer"
                        >
                          {section.name}
                        </label>
                        <span className="text-xs text-muted-foreground">
                          ({section.wordCount.toLocaleString()} words)
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
            <hr className="border-border my-6" />
            {/* Course structure toggle */}
            {courseStructure && (
              <>
                <div className="flex items-start gap-2 py-1 px-2">
                  <Checkbox
                    id="include-course-structure"
                    className="mt-1"
                    checked={includeCourseStructure}
                    onCheckedChange={(checked) => {
                      onIncludeCourseStructureChange(!!checked);
                    }}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="include-course-structure"
                      className="text-sm cursor-pointer"
                    >
                      Course Structure
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Include repo/section/lesson tree so the LLM knows where
                      this lesson fits in the course
                    </p>
                  </div>
                </div>
                <hr className="border-border my-6" />
              </>
            )}
            {/* File tree - lesson-connected videos */}
            {!isStandalone && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 py-1 px-2">
                  <Checkbox
                    id="include-files"
                    checked={
                      files.length === 0
                        ? false
                        : enabledFiles.size === files.length
                          ? true
                          : enabledFiles.size > 0
                            ? "indeterminate"
                            : false
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onEnabledFilesChange(new Set(files.map((f) => f.path)));
                      } else {
                        onEnabledFilesChange(new Set());
                      }
                    }}
                  />
                  <label
                    htmlFor="include-files"
                    className="text-sm flex-1 cursor-pointer"
                  >
                    Files
                  </label>
                  {onOpenFolderClick && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={onOpenFolderClick}
                      title="Open folder"
                    >
                      <FolderOpenIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {onAddFromClipboardClick && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={onAddFromClipboardClick}
                    >
                      <ClipboardIcon className="h-3 w-3 mr-1" />
                      Add from Clipboard
                    </Button>
                  )}
                </div>
                <FileTree
                  files={files}
                  enabledFiles={enabledFiles}
                  onEnabledFilesChange={onEnabledFilesChange}
                  onFileClick={onFileClick}
                  onDeleteFile={onDeleteFile}
                />
              </div>
            )}
            {/* Standalone file tree */}
            {isStandalone && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 py-1 px-2">
                  <Checkbox
                    id="include-standalone-files"
                    checked={
                      files.length === 0
                        ? false
                        : enabledFiles.size === files.length
                          ? true
                          : enabledFiles.size > 0
                            ? "indeterminate"
                            : false
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onEnabledFilesChange(new Set(files.map((f) => f.path)));
                      } else {
                        onEnabledFilesChange(new Set());
                      }
                    }}
                  />
                  <label
                    htmlFor="include-standalone-files"
                    className="text-sm flex-1 cursor-pointer"
                  >
                    Files
                  </label>
                  {onOpenFolderClick && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={onOpenFolderClick}
                      title="Open folder"
                    >
                      <FolderOpenIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {onAddFromClipboardClick && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={onAddFromClipboardClick}
                    >
                      <ClipboardIcon className="h-3 w-3 mr-1" />
                      Add from Clipboard
                    </Button>
                  )}
                </div>
                <StandaloneFileTree
                  files={files}
                  enabledFiles={enabledFiles}
                  onEnabledFilesChange={onEnabledFilesChange}
                  onEditFile={onEditFile ?? (() => {})}
                  onDeleteFile={onDeleteFile ?? (() => {})}
                  onFileClick={onFileClick}
                />
              </div>
            )}
          </>
        )}
        {sidebarTab === "links" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 py-1 px-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm flex-1">Links</span>
              <span className="text-xs text-muted-foreground">
                ({links.length})
              </span>
              {onAddLinkClick && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onAddLinkClick}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
            {links.length > 0 ? (
              <div className="space-y-1 px-2">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-start gap-2 py-1 px-2 rounded hover:bg-muted/50 group text-sm"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 flex-1 min-w-0"
                    >
                      <ExternalLinkIcon className="h-3 w-3 mt-1 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{link.title}</div>
                        {link.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {link.description}
                          </div>
                        )}
                      </div>
                    </a>
                    {onDeleteLink && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        onClick={() => onDeleteLink(link.id)}
                      >
                        <Trash2Icon className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-2 text-sm text-muted-foreground">
                No links yet
              </div>
            )}
          </div>
        )}
        {sidebarTab === "memory" && (
          <div className="flex flex-col gap-3 h-full">
            <div className="flex items-center gap-2 py-1 px-2">
              <Checkbox
                id="memory-enabled"
                checked={memoryEnabled ?? false}
                onCheckedChange={(checked) => {
                  onMemoryEnabledChange?.(!!checked);
                }}
              />
              <label
                htmlFor="memory-enabled"
                className="text-sm flex-1 cursor-pointer"
              >
                Include memory in prompts
              </label>
            </div>
            <textarea
              className="flex-1 w-full bg-muted/50 border border-border rounded-md p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              placeholder="Add course-level memory here (style guides, spellings, context...)"
              value={memory ?? ""}
              onChange={(e) => onMemoryChange?.(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
});
