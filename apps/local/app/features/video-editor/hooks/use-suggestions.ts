import { useEffect, useMemo } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { readStored, writeStored } from "@/hooks/use-local-storage";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import type { BeatListBeat } from "@/features/beats/beat-list";
import type { BeatKind } from "@/features/beats/beat-kinds";
import { formatAnimaticContext } from "@/features/article-writer/format-animatic-context";
import { formatBeatsContext } from "@/features/article-writer/format-beats-context";
import type {
  FrontendInsertionPoint,
  TimelineItem,
} from "../clip-state-reducer";
import {
  ALL_SOURCES_INCLUDED,
  createInitialSuggestionsState,
  getTeleprompterSuggestion,
  suggestionsReducer,
  suggestionsStateReducer,
} from "../suggestions-reducer";
import {
  getClipTranscriptsBeforeInsertionPoint,
  getTranscribedClipIds,
} from "../video-editor-selectors";

/** One choice for every Video, not one per Video. */
const INCLUDED_SOURCES_KEY = "video-editor:suggestions-sources";

/** The Notes are this Video's own, and never leave the browser. */
const notesKey = (videoId: string) =>
  `video-editor:suggestions-notes:${videoId}`;

/** How long typing in the Notes must pause before a new suggestion. */
const NOTES_PAUSE_MS = 1000;

const readIncludedSources = (): suggestionsReducer.Included => {
  try {
    const raw = readStored(INCLUDED_SOURCES_KEY);
    if (!raw) return ALL_SOURCES_INCLUDED;
    const parsed = JSON.parse(raw) as Partial<suggestionsReducer.Included>;
    return {
      notes: parsed.notes !== false,
      script: parsed.script !== false,
      animatic: parsed.animatic !== false,
      beats: parsed.beats !== false,
    };
  } catch {
    return ALL_SOURCES_INCLUDED;
  }
};

/**
 * The Suggestions tab's effect runner and its bridges to the editor. Every
 * decision is in `suggestions-reducer.ts`; this only does the I/O and reports
 * what the editor's state is.
 */
export function useSuggestions(input: {
  videoId: string;
  /** Whether the Suggestions tab is the one showing. */
  open: boolean;
  animatic: AnimaticLine[];
  beats: BeatListBeat[];
  /** The timeline's items, archived ones left out. */
  items: TimelineItem[];
  insertionPoint: FrontendInsertionPoint;
}) {
  const [state, dispatch] = useEffectReducer<
    suggestionsReducer.State,
    suggestionsReducer.Action,
    suggestionsReducer.Effect
  >(
    suggestionsStateReducer,
    () =>
      createInitialSuggestionsState({
        videoId: input.videoId,
        included: readIncludedSources(),
        notes: readStored(notesKey(input.videoId)) ?? "",
      }),
    {
      // The teleprompter's content route: the Script and nothing heavier.
      "load-script": (_state, effect, dispatch) => {
        fetch(`/api/teleprompter/${effect.videoId}/content`)
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as { script: string };
            return json.script;
          })
          // No Script is still worth a suggestion from the other sources.
          .catch(() => "")
          .then((script) =>
            dispatch({ type: "script-loaded", videoId: effect.videoId, script })
          );
      },
      "stream-suggestion": (_state, effect, dispatch) => {
        const controller = new AbortController();
        const { requestId } = effect;
        (async () => {
          const res = await fetch(
            `/videos/${effect.videoId}/suggest-next-clip`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(effect.input),
              signal: controller.signal,
            }
          );
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let text = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            dispatch({ type: "suggestion-chunk-received", requestId, text });
          }
          dispatch({ type: "suggestion-finished", requestId });
        })().catch(() => {
          if (!controller.signal.aborted) {
            dispatch({ type: "suggestion-failed", requestId });
          }
        });
        return () => controller.abort();
      },
      "store-included-sources": (_state, effect) => {
        writeStored(INCLUDED_SOURCES_KEY, JSON.stringify(effect.included));
      },
      "store-notes": (_state, effect) => {
        writeStored(notesKey(effect.videoId), effect.notes);
      },
      "wait-for-notes-pause": (_state, effect, dispatch) => {
        const timer = setTimeout(
          () =>
            dispatch({ type: "notes-pause-elapsed", editId: effect.editId }),
          NOTES_PAUSE_MS
        );
        return () => clearTimeout(timer);
      },
    }
  );

  // Bridge: the tab opening and closing.
  useEffect(() => {
    dispatch({
      type: input.open ? "suggestions-tab-opened" : "suggestions-tab-closed",
    });
  }, [input.open, dispatch]);

  // Bridge: what the editor holds that a suggestion is made from. Keyed on
  // content, so a re-render with the same Clips sends nothing.
  const animatic = useMemo(
    () => formatAnimaticContext(input.animatic),
    [input.animatic]
  );
  const beats = useMemo(
    () =>
      formatBeatsContext(
        input.beats.map((beat) => ({
          kind: beat.kind as BeatKind,
          title: beat.title,
          description: beat.description,
        }))
      ),
    [input.beats]
  );
  const clips = useMemo(
    () =>
      getClipTranscriptsBeforeInsertionPoint(input.items, input.insertionPoint),
    [input.items, input.insertionPoint]
  );
  const transcribedClipIds = useMemo(
    () => getTranscribedClipIds(input.items),
    [input.items]
  );
  const clipsKey = JSON.stringify(clips);
  const transcribedKey = transcribedClipIds.join(",");
  useEffect(() => {
    dispatch({
      type: "editor-context-changed",
      context: {
        animatic,
        beats,
        clips: JSON.parse(clipsKey) as string[],
        transcribedClipIds:
          transcribedKey === "" ? [] : transcribedKey.split(","),
      },
    });
  }, [animatic, beats, clipsKey, transcribedKey, dispatch]);

  return {
    state,
    /** What the teleprompter shows in place of the Script, or `null`. */
    teleprompterSuggestion: getTeleprompterSuggestion(state),
    onToggleSource: (source: suggestionsReducer.Source) =>
      dispatch({ type: "source-toggled", source }),
    onRefresh: () => dispatch({ type: "refresh-clicked" }),
    onNotesChange: (notes: string) => dispatch({ type: "notes-edited", notes }),
  };
}

export type SuggestionsTab = ReturnType<typeof useSuggestions>;
