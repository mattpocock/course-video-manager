"use client";

import { memo, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SectionWithWordCount } from "./types";

const encoder = new TextEncoder();
const estimateTokens = (s: string) => Math.ceil(encoder.encode(s).length / 4);
const fmtTok = (n: number) =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;

export interface ContextSourceConfig {
  key: string;
  label: string;
  enabled: boolean;
  tokenCount: number;
  indeterminate?: boolean;
}

export interface InlineContextStripProps {
  sources: ContextSourceConfig[];
  totalTokens: number;
  onToggleSource: (key: string) => void;
  onOpenContext?: () => void;
  className?: string;
}

export const InlineContextStrip = memo(function InlineContextStrip({
  sources,
  totalTokens,
  onToggleSource,
  onOpenContext,
  className,
}: InlineContextStripProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30",
        className
      )}
    >
      <span className="text-xs text-muted-foreground mr-1">
        {fmtTok(totalTokens)}
      </span>
      {sources.map((source) => (
        <button
          key={source.key}
          onClick={() => onToggleSource(source.key)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors",
            source.enabled
              ? "bg-foreground/10 text-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Checkbox
            checked={source.indeterminate ? "indeterminate" : source.enabled}
            className="h-3 w-3 pointer-events-none"
            tabIndex={-1}
          />
          <span>{source.label}</span>
          <span className="text-muted-foreground">
            {fmtTok(source.tokenCount)}
          </span>
        </button>
      ))}
      {onOpenContext && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={onOpenContext}
        >
          <Layers className="h-3 w-3 mr-1" />
          Context
        </Button>
      )}
    </div>
  );
});

export function useContextSources(opts: {
  transcript: string;
  chapters: SectionWithWordCount[];
  enabledSections: Set<string>;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  enabledFiles: Set<string>;
  links: Array<{ url: string; title: string }>;
  courseStructure: unknown | null;
  includeCourseStructure: boolean;
  memory: string;
  memoryEnabled: boolean;
}): { sources: ContextSourceConfig[]; totalTokens: number } {
  const {
    transcript,
    chapters,
    enabledSections,
    files,
    enabledFiles,
    links,
    courseStructure,
    includeCourseStructure,
    memory,
    memoryEnabled,
  } = opts;

  return useMemo(() => {
    const sources: ContextSourceConfig[] = [];
    let total = 0;

    // Transcript / chapters
    if (transcript) {
      const chaptersEnabled = enabledSections.size;
      const chaptersTotal = chapters.length;
      const transcriptTokens = estimateTokens(transcript);
      const enabled = chaptersTotal > 0 ? chaptersEnabled > 0 : true;
      sources.push({
        key: "transcript",
        label: "Transcript",
        enabled,
        tokenCount: transcriptTokens,
        indeterminate:
          chaptersTotal > 0 &&
          chaptersEnabled > 0 &&
          chaptersEnabled < chaptersTotal,
      });
      if (enabled) total += transcriptTokens;
    }

    // Files
    if (files.length > 0) {
      const filesEnabled = enabledFiles.size;
      const filesTokens = files
        .filter((f) => enabledFiles.has(f.path))
        .reduce((sum, f) => sum + Math.ceil(f.size / 4), 0);
      sources.push({
        key: "files",
        label: "Files",
        enabled: filesEnabled > 0,
        tokenCount: filesTokens,
        indeterminate: filesEnabled > 0 && filesEnabled < files.length,
      });
      if (filesEnabled > 0) total += filesTokens;
    }

    // Links
    if (links.length > 0) {
      const linksText = links.map((l) => `${l.url} ${l.title}`).join("\n");
      const linksTokens = estimateTokens(linksText);
      sources.push({
        key: "links",
        label: "Links",
        enabled: true,
        tokenCount: linksTokens,
      });
      total += linksTokens;
    }

    // Course structure
    if (courseStructure) {
      const structTokens = estimateTokens(JSON.stringify(courseStructure));
      sources.push({
        key: "courseStructure",
        label: "Course",
        enabled: includeCourseStructure,
        tokenCount: structTokens,
      });
      if (includeCourseStructure) total += structTokens;
    }

    // Memory
    if (memory) {
      const memTokens = estimateTokens(memory);
      sources.push({
        key: "memory",
        label: "Memory",
        enabled: memoryEnabled,
        tokenCount: memTokens,
      });
      if (memoryEnabled) total += memTokens;
    }

    return { sources, totalTokens: total };
  }, [
    transcript,
    chapters,
    enabledSections,
    files,
    enabledFiles,
    links,
    courseStructure,
    includeCourseStructure,
    memory,
    memoryEnabled,
  ]);
}
