"use client";

import { useMemo, useCallback } from "react";
import type { WriterContext } from "./writer-engine";
import type { SourceView } from "./inline-context-strip";
import { parseStringSet, readStored } from "@/hooks/use-local-storage";
import { LINKS_DISABLED_STORAGE_KEY } from "./write-utils";
import { formatBeatsContext } from "./format-beats-context";
import { formatAnimaticContext } from "./format-animatic-context";
import type { contextPanelReducer } from "./context-panel-reducer";
import {
  REMEMBERED_TOGGLE_STORAGE_KEYS,
  useContextPanelReducer,
} from "./use-context-panel-reducer";
import {
  selectContextSources,
  selectPromptTexts,
  type PageField,
  type PromptTexts,
} from "./context-panel-selectors";

export type { PageField, PromptTexts };

export interface ContextModel {
  sources: SourceView[];
  totalTokens: number;

  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  enabledFields: Set<string>;
  includeTranscript: boolean;
  includeCourseStructure: boolean;
  /** Annotate the transcript's clips with their diagrams' text. */
  diagramTextEnabled: boolean;

  toggleItem: (itemId: string) => void;
  toggleSource: (sourceKey: string) => void;
  setSourceEnabled: (sourceKey: string, enabledIds: Set<string>) => void;

  memoryText: string;
  setMemoryText: (text: string) => void;

  // What the completion routes are sent for memory, beats, script and animatic
  promptTexts: PromptTexts;

  // Links (read from context, mutation via callbacks on the host)
  links: Array<{
    id: string;
    url: string;
    title: string;
    description?: string;
  }>;
}

const readRemembered = (): contextPanelReducer.Remembered => {
  const readToggle = (
    toggle: contextPanelReducer.RememberedToggle,
    fallback: boolean
  ) =>
    (readStored(REMEMBERED_TOGGLE_STORAGE_KEYS[toggle]) ?? String(fallback)) ===
    "true";
  return {
    courseStructure: readToggle("courseStructure", false),
    memory: readToggle("memory", false),
    beats: readToggle("beats", false),
    script: readToggle("script", true),
    animatic: readToggle("animatic", true),
    diagramText: readToggle("diagramText", true),
    disabledLinks: parseStringSet(
      readStored(LINKS_DISABLED_STORAGE_KEY) ?? "[]"
    ),
  };
};

/**
 * The Article Writer's context: `contextPanelReducer` with the toggles the
 * writer remembers, plus the sources built from it.
 */
export function useContextModel(
  context: WriterContext,
  pageFields: PageField[] = []
): ContextModel {
  const { state, dispatch } = useContextPanelReducer(() => ({
    files: context.files,
    chapters: context.chapters,
    memory: context.memory,
    remembered: readRemembered(),
  }));

  const beatsText = useMemo(
    () => formatBeatsContext(context.beats),
    [context.beats]
  );
  const scriptText = context.script;
  const animaticText = useMemo(
    () => formatAnimaticContext(context.animaticLines),
    [context.animaticLines]
  );
  const diagramText = useMemo(
    () =>
      context.diagramTexts
        .map((d) => `[${d.clipIndex}] ${d.diagramName}: ${d.text}`)
        .join("\n"),
    [context.diagramTexts]
  );

  const sources = useMemo(
    () =>
      selectContextSources(state, {
        chapters: context.chapters,
        transcript: context.transcript,
        files: context.files,
        links: context.links,
        courseStructure: context.courseStructure,
        pageFields,
        beatsText,
        scriptText,
        animaticText,
        diagramText,
      }),
    [
      state,
      context.chapters,
      context.transcript,
      context.files,
      context.links,
      context.courseStructure,
      pageFields,
      beatsText,
      scriptText,
      animaticText,
      diagramText,
    ]
  );

  const totalTokens = useMemo(
    () => sources.reduce((sum, s) => sum + s.tokens, 0),
    [sources]
  );

  const toggleItem = useCallback(
    (itemId: string) => {
      const source = sources.find((s) =>
        s.items.some((item) => item.id === itemId)
      );
      if (!source) return;
      dispatch({
        type: "item-toggled",
        source: source.key,
        itemId,
        atomic: source.atomic,
      });
    },
    [sources, dispatch]
  );

  const toggleSource = useCallback(
    (sourceKey: string) => {
      const source = sources.find((s) => s.key === sourceKey);
      if (!source) return;
      dispatch({
        type: "source-toggled",
        source: source.key,
        itemIds: source.items.map((item) => item.id),
        atomic: source.atomic,
      });
    },
    [sources, dispatch]
  );

  const setSourceEnabled = useCallback(
    (sourceKey: string, enabledIds: Set<string>) => {
      if (sourceKey === "transcript") {
        dispatch({ type: "sections-picked", sectionIds: enabledIds });
      } else if (sourceKey === "files") {
        dispatch({ type: "files-picked", paths: enabledIds });
      }
    },
    [dispatch]
  );

  const setMemoryText = useCallback(
    (text: string) => dispatch({ type: "memory-edited", text }),
    [dispatch]
  );

  const links = useMemo(
    () => context.links.map((l) => ({ ...l })),
    [context.links]
  );

  const { memoryEnabled, memoryText, beatsEnabled, scriptEnabled } = state;
  const { animaticEnabled } = state;
  const promptTexts = useMemo(
    () =>
      selectPromptTexts(
        {
          memoryEnabled,
          memoryText,
          beatsEnabled,
          scriptEnabled,
          animaticEnabled,
        },
        { beatsText, scriptText, animaticText }
      ),
    [
      memoryEnabled,
      memoryText,
      beatsEnabled,
      scriptEnabled,
      animaticEnabled,
      beatsText,
      scriptText,
      animaticText,
    ]
  );

  return {
    sources,
    totalTokens,

    enabledFiles: state.enabledFiles,
    enabledSections: state.enabledSections,
    enabledFields: state.enabledFields,
    includeTranscript: state.includeTranscript,
    includeCourseStructure: state.includeCourseStructure,
    diagramTextEnabled: state.diagramTextEnabled,

    toggleItem,
    toggleSource,
    setSourceEnabled,

    memoryText: state.memoryText,
    setMemoryText,

    promptTexts,

    links,
  };
}
