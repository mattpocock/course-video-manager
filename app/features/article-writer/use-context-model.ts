"use client";

import { useState, useMemo, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WriterContext } from "./writer-engine";
import { estimateTokens, type SourceView } from "./inline-context-strip";

export interface ContextModel {
  sources: SourceView[];
  totalTokens: number;

  // Toggle state
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  enabledFields: Set<string>;
  includeTranscript: boolean;
  includeCourseStructure: boolean;
  memoryEnabled: boolean;

  // Mutation callbacks
  toggleItem: (itemId: string) => void;
  toggleSource: (sourceKey: string) => void;
  setSourceEnabled: (sourceKey: string, enabledIds: Set<string>) => void;

  // Setters for host state
  setEnabledFiles: Dispatch<SetStateAction<Set<string>>>;
  setEnabledSections: Dispatch<SetStateAction<Set<string>>>;
  setIncludeTranscript: Dispatch<SetStateAction<boolean>>;
  setIncludeCourseStructure: Dispatch<SetStateAction<boolean>>;
  setMemoryEnabled: Dispatch<SetStateAction<boolean>>;

  // Memory editing
  memoryText: string;
  setMemoryText: Dispatch<SetStateAction<string>>;

  // Links (read from context, mutation via callbacks on the host)
  links: Array<{
    id: string;
    url: string;
    title: string;
    description?: string;
  }>;
}

export type PageField = { id: string; label: string; value: string };

export function useContextModel(
  context: WriterContext,
  pageFields: PageField[] = []
): ContextModel {
  // ── Toggle state ──────────────────────────────────────────────────────────

  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(
    () =>
      new Set(context.files.filter((f) => f.defaultEnabled).map((f) => f.path))
  );
  // Page fields (other fields on the same page) default to OFF — they are
  // opt-in extra context.
  const [enabledFields, setEnabledFields] = useState<Set<string>>(
    () => new Set()
  );
  const [enabledSections, setEnabledSections] = useState<Set<string>>(
    () => new Set(context.chapters.map((s) => s.id))
  );
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [includeCourseStructure, setIncludeCourseStructure] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryText, setMemoryText] = useState(context.memory);
  // Links default to on; we track the *disabled* ids so links added after mount
  // (via revalidation) are included by default.
  const [disabledLinks, setDisabledLinks] = useState<Set<string>>(
    () => new Set()
  );

  // ── Build sources ─────────────────────────────────────────────────────────

  const sources = useMemo(() => {
    const result: SourceView[] = [];

    // 1. Transcript
    const hasChapters = context.chapters.length > 0;
    if (hasChapters) {
      const items = context.chapters.map((ch) => {
        // Rough heuristic: 4 chars per word → byte length ≈ wordCount * 4 → tokens ≈ wordCount
        const tokens = ch.wordCount;
        return {
          id: ch.id,
          label: ch.name,
          text: ch.name,
          on: enabledSections.has(ch.id),
          tokens,
        };
      });
      const onCount = items.filter((i) => i.on).length;
      result.push({
        key: "transcript",
        label: "Transcript",
        note: "clips.text, split by chapter — deselect chapters to trim it",
        items,
        onCount,
        check:
          onCount === 0
            ? false
            : onCount === items.length
              ? true
              : "indeterminate",
        atomic: false,
        tokens: items.filter((i) => i.on).reduce((sum, i) => sum + i.tokens, 0),
      });
    } else {
      const text = context.transcript;
      const tokens = estimateTokens(text);
      const on = includeTranscript;
      result.push({
        key: "transcript",
        label: "Transcript",
        note: "clips.text, split by chapter — deselect chapters to trim it",
        items: [
          { id: "transcript", label: "Full transcript", text, on, tokens },
        ],
        onCount: on ? 1 : 0,
        check: on,
        atomic: true,
        tokens: on ? tokens : 0,
      });
    }

    // 2. Files
    if (context.files.length > 0) {
      const items = context.files.map((f) => {
        const tokens = Math.ceil(f.size / 4);
        return {
          id: f.path,
          label: f.path,
          text: f.path,
          on: enabledFiles.has(f.path),
          tokens,
        };
      });
      const onCount = items.filter((i) => i.on).length;
      result.push({
        key: "files",
        label: "Repo files",
        note: "lesson files",
        items,
        onCount,
        check:
          onCount === 0
            ? false
            : onCount === items.length
              ? true
              : "indeterminate",
        atomic: false,
        tokens: items.filter((i) => i.on).reduce((sum, i) => sum + i.tokens, 0),
      });
    }

    // 2b. Page fields (other fields on the same page)
    if (pageFields.length > 0) {
      const items = pageFields.map((f) => ({
        id: f.id,
        label: f.label,
        text: f.value,
        on: enabledFields.has(f.id),
        tokens: estimateTokens(f.value),
      }));
      const onCount = items.filter((i) => i.on).length;
      result.push({
        key: "fields",
        label: "Page fields",
        note: "other fields on this page",
        items,
        onCount,
        check:
          onCount === 0
            ? false
            : onCount === items.length
              ? true
              : "indeterminate",
        atomic: false,
        tokens: items.filter((i) => i.on).reduce((sum, i) => sum + i.tokens, 0),
      });
    }

    // 3. Links
    if (context.links.length > 0) {
      const items = context.links.map((l) => ({
        id: l.id,
        label: l.title,
        text: l.url,
        on: !disabledLinks.has(l.id),
        tokens: estimateTokens(l.url),
      }));
      const onCount = items.filter((i) => i.on).length;
      result.push({
        key: "links",
        label: "Links",
        note: "reference URLs on the video",
        items,
        onCount,
        check:
          onCount === 0
            ? false
            : onCount === items.length
              ? true
              : "indeterminate",
        atomic: false,
        tokens: items.filter((i) => i.on).reduce((sum, i) => sum + i.tokens, 0),
      });
    }

    // 4. Course structure (only if present)
    if (context.courseStructure !== null) {
      const text = JSON.stringify(context.courseStructure);
      const tokens = estimateTokens(text);
      const on = includeCourseStructure;
      result.push({
        key: "courseStructure",
        label: "Course structure",
        note: "sections / lessons tree",
        items: [
          {
            id: "courseStructure",
            label: "Course structure",
            text,
            on,
            tokens,
          },
        ],
        onCount: on ? 1 : 0,
        check: on,
        atomic: true,
        tokens: on ? tokens : 0,
      });
    }

    // 5. Memory (only if non-empty)
    if (memoryText.length > 0) {
      const tokens = estimateTokens(memoryText);
      const on = memoryEnabled;
      result.push({
        key: "memory",
        label: "Course memory",
        note: "standing style preferences",
        items: [
          {
            id: "memory",
            label: "Course memory",
            text: memoryText,
            on,
            tokens,
          },
        ],
        onCount: on ? 1 : 0,
        check: on,
        atomic: true,
        tokens: on ? tokens : 0,
      });
    }

    return result;
  }, [
    context.chapters,
    context.transcript,
    context.files,
    context.links,
    context.courseStructure,
    memoryText,
    enabledSections,
    enabledFiles,
    enabledFields,
    pageFields,
    disabledLinks,
    includeTranscript,
    includeCourseStructure,
    memoryEnabled,
  ]);

  const totalTokens = useMemo(
    () => sources.reduce((sum, s) => sum + s.tokens, 0),
    [sources]
  );

  // ── Mutation callbacks ────────────────────────────────────────────────────

  const toggleItem = useCallback(
    (itemId: string) => {
      // Chapter items → toggle in enabledSections
      if (
        context.chapters.length > 0 &&
        context.chapters.some((ch) => ch.id === itemId)
      ) {
        setEnabledSections((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
        return;
      }

      // Atomic transcript (no chapters)
      if (itemId === "transcript") {
        setIncludeTranscript((prev) => !prev);
        return;
      }

      // File items → toggle in enabledFiles
      if (context.files.some((f) => f.path === itemId)) {
        setEnabledFiles((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
        return;
      }

      // Page field items → toggle in enabledFields (default off)
      if (pageFields.some((f) => f.id === itemId)) {
        setEnabledFields((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
        return;
      }

      // Link items → toggle in disabledLinks (default on)
      if (context.links.some((l) => l.id === itemId)) {
        setDisabledLinks((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
        return;
      }

      // Atomic sources
      if (itemId === "courseStructure") {
        setIncludeCourseStructure((prev) => !prev);
        return;
      }
      if (itemId === "memory") {
        setMemoryEnabled((prev) => !prev);
        return;
      }
    },
    [context.chapters, context.files, context.links, pageFields]
  );

  const toggleSource = useCallback(
    (sourceKey: string) => {
      switch (sourceKey) {
        case "transcript": {
          if (context.chapters.length > 0) {
            const allOn = context.chapters.every((ch) =>
              enabledSections.has(ch.id)
            );
            if (allOn) {
              setEnabledSections(new Set());
            } else {
              setEnabledSections(new Set(context.chapters.map((ch) => ch.id)));
            }
          } else {
            setIncludeTranscript((prev) => !prev);
          }
          break;
        }
        case "files": {
          const allOn = context.files.every((f) => enabledFiles.has(f.path));
          if (allOn) {
            setEnabledFiles(new Set());
          } else {
            setEnabledFiles(new Set(context.files.map((f) => f.path)));
          }
          break;
        }
        case "links": {
          const allOn = context.links.every((l) => !disabledLinks.has(l.id));
          if (allOn) {
            setDisabledLinks(new Set(context.links.map((l) => l.id)));
          } else {
            setDisabledLinks(new Set());
          }
          break;
        }
        case "fields": {
          const allOn = pageFields.every((f) => enabledFields.has(f.id));
          if (allOn) {
            setEnabledFields(new Set());
          } else {
            setEnabledFields(new Set(pageFields.map((f) => f.id)));
          }
          break;
        }
        case "courseStructure":
          setIncludeCourseStructure((prev) => !prev);
          break;
        case "memory":
          setMemoryEnabled((prev) => !prev);
          break;
      }
    },
    [
      context.chapters,
      context.files,
      context.links,
      pageFields,
      enabledSections,
      enabledFiles,
      enabledFields,
      disabledLinks,
    ]
  );

  const setSourceEnabled = useCallback(
    (sourceKey: string, enabledIds: Set<string>) => {
      switch (sourceKey) {
        case "transcript":
          setEnabledSections(enabledIds);
          break;
        case "files":
          setEnabledFiles(enabledIds);
          break;
      }
    },
    []
  );

  // ── Links ─────────────────────────────────────────────────────────────────

  const links = useMemo(
    () => context.links.map((l) => ({ ...l })),
    [context.links]
  );

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    sources,
    totalTokens,

    enabledFiles,
    enabledSections,
    enabledFields,
    includeTranscript,
    includeCourseStructure,
    memoryEnabled,

    toggleItem,
    toggleSource,
    setSourceEnabled,

    setEnabledFiles,
    setEnabledSections,
    setIncludeTranscript,
    setIncludeCourseStructure,
    setMemoryEnabled,

    memoryText,
    setMemoryText,

    links,
  };
}
