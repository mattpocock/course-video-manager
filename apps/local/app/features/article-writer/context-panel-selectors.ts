import { estimateTokens, type SourceView } from "./inline-context-strip";
import type { contextPanelReducer } from "./context-panel-reducer";

/**
 * The single-text sources as the completion routes take them: each one's text
 * when it is switched on and non-empty, else `undefined`.
 */
export interface PromptTexts {
  memory: string | undefined;
  beats: string | undefined;
  script: string | undefined;
  animatic: string | undefined;
}

export type PageField = { id: string; label: string; value: string };

/** What the sources are built from, besides the panel's own state. */
export interface ContextSourcesInput {
  chapters: Array<{ id: string; name: string; wordCount: number }>;
  transcript: string;
  files: Array<{ path: string; size: number }>;
  links: Array<{ id: string; title: string; url: string }>;
  courseStructure: unknown | null;
  pageFields: PageField[];
  beatsText: string;
  scriptText: string;
  animaticText: string;
  diagramText: string;
}

type Item = SourceView["items"][number];

const pickableSource = (
  head: Pick<SourceView, "key" | "label" | "note">,
  items: Item[]
): SourceView => {
  const onCount = items.filter((i) => i.on).length;
  return {
    ...head,
    items,
    onCount,
    check:
      onCount === 0 ? false : onCount === items.length ? true : "indeterminate",
    atomic: false,
    tokens: items.filter((i) => i.on).reduce((sum, i) => sum + i.tokens, 0),
  };
};

const atomicSource = (
  head: Pick<SourceView, "key" | "label" | "note">,
  item: Omit<Item, "tokens">
): SourceView => {
  const tokens = estimateTokens(item.text);
  return {
    ...head,
    items: [{ ...item, tokens }],
    onCount: item.on ? 1 : 0,
    check: item.on,
    atomic: true,
    tokens: item.on ? tokens : 0,
  };
};

/** The sources the Article Writer shows, in the order it shows them. */
export function selectContextSources(
  state: contextPanelReducer.State,
  input: ContextSourcesInput
): SourceView[] {
  const result: SourceView[] = [];
  const transcriptHead = {
    key: "transcript",
    label: "Transcript",
    note: "clips.text, split by chapter — deselect chapters to trim it",
  };

  // 1. Transcript
  if (input.chapters.length > 0) {
    result.push(
      pickableSource(
        transcriptHead,
        input.chapters.map((ch) => ({
          id: ch.id,
          label: ch.name,
          text: ch.name,
          on: state.enabledSections.has(ch.id),
          // Rough heuristic: 4 chars per word → bytes ≈ wordCount * 4 → tokens ≈ wordCount
          tokens: ch.wordCount,
        }))
      )
    );
  } else {
    result.push(
      atomicSource(transcriptHead, {
        id: "transcript",
        label: "Full transcript",
        text: input.transcript,
        on: state.includeTranscript,
      })
    );
  }

  // 1b. Diagram text (only if a clip pins a diagram with text). It rides
  // inside the transcript, next to the clip each diagram was on screen for.
  if (input.diagramText.length > 0) {
    result.push(
      atomicSource(
        {
          key: "diagramText",
          label: "Diagram text",
          note: "the text on each clip's diagram, inlined next to that clip in the transcript",
        },
        {
          id: "diagramText",
          label: "Diagram text",
          text: input.diagramText,
          on: state.diagramTextEnabled,
        }
      )
    );
  }

  // 2. Files
  if (input.files.length > 0) {
    result.push(
      pickableSource(
        { key: "files", label: "Repo files", note: "lesson files" },
        input.files.map((f) => ({
          id: f.path,
          label: f.path,
          text: f.path,
          on: state.enabledFiles.has(f.path),
          tokens: Math.ceil(f.size / 4),
        }))
      )
    );
  }

  // 2b. Page fields (other fields on the same page)
  if (input.pageFields.length > 0) {
    result.push(
      pickableSource(
        {
          key: "fields",
          label: "Page fields",
          note: "other fields on this page",
        },
        input.pageFields.map((f) => ({
          id: f.id,
          label: f.label,
          text: f.value,
          on: state.enabledFields.has(f.id),
          tokens: estimateTokens(f.value),
        }))
      )
    );
  }

  // 3. Links
  if (input.links.length > 0) {
    result.push(
      pickableSource(
        { key: "links", label: "Links", note: "reference URLs on the video" },
        input.links.map((l) => ({
          id: l.id,
          label: l.title,
          text: l.url,
          on: !state.disabledLinks.has(l.id),
          tokens: estimateTokens(l.url),
        }))
      )
    );
  }

  // 4. Script (only if non-empty — most videos have none)
  if (input.scriptText.trim().length > 0) {
    result.push(
      atomicSource(
        {
          key: "script",
          label: "Script",
          note: "the base Matt improvised from — authoritative for spelling and naming",
        },
        {
          id: "script",
          label: "Script",
          text: input.scriptText,
          on: state.scriptEnabled,
        }
      )
    );
  }

  // 5. Beats (only if non-empty)
  if (input.beatsText.length > 0) {
    result.push(
      atomicSource(
        {
          key: "beats",
          label: "Beats",
          note: "video beat plan with descriptions",
        },
        {
          id: "beats",
          label: "Beat plan",
          text: input.beatsText,
          on: state.beatsEnabled,
        }
      )
    );
  }

  // 5b. Animatic (only if the video has Clip Mockups)
  if (input.animaticText.length > 0) {
    result.push(
      atomicSource(
        {
          key: "animatic",
          label: "Animatic",
          note: "the Clip Mockup lines under their chapters, with the author's comments (text only, no stills)",
        },
        {
          id: "animatic",
          label: "Animatic",
          text: input.animaticText,
          on: state.animaticEnabled,
        }
      )
    );
  }

  // 6. Course structure (only if present)
  if (input.courseStructure !== null) {
    result.push(
      atomicSource(
        {
          key: "courseStructure",
          label: "Course structure",
          note: "sections / lessons tree",
        },
        {
          id: "courseStructure",
          label: "Course structure",
          text: JSON.stringify(input.courseStructure),
          on: state.includeCourseStructure,
        }
      )
    );
  }

  // 7. Memory (only if non-empty)
  if (state.memoryText.length > 0) {
    result.push(
      atomicSource(
        {
          key: "memory",
          label: "Course memory",
          note: "standing style preferences",
        },
        {
          id: "memory",
          label: "Course memory",
          text: state.memoryText,
          on: state.memoryEnabled,
        }
      )
    );
  }

  return result;
}

/** What the completion routes are sent for memory, beats, script and animatic. */
export function selectPromptTexts(
  state: Pick<
    contextPanelReducer.State,
    | "memoryEnabled"
    | "memoryText"
    | "beatsEnabled"
    | "scriptEnabled"
    | "animaticEnabled"
  >,
  texts: { beatsText: string; scriptText: string; animaticText: string }
): PromptTexts {
  return {
    memory:
      state.memoryEnabled && state.memoryText ? state.memoryText : undefined,
    beats: state.beatsEnabled && texts.beatsText ? texts.beatsText : undefined,
    script:
      state.scriptEnabled && texts.scriptText ? texts.scriptText : undefined,
    animatic:
      state.animaticEnabled && texts.animaticText
        ? texts.animaticText
        : undefined,
  };
}
