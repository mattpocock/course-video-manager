import { extractSceneText } from "./extract-scene-text/index.js";
import { sortByOrder } from "./sort-by-order.js";
import type {
  IndexedClip,
  IndexedClipRecordingSession,
  SectionWithWordCount,
} from "./transcript-types.js";
import type { RecordingSessionScene } from "../features/videos/recorder.js";

export interface TranscriptWebLink {
  url: string;
  title: string | null;
}

export interface ClipInput {
  order: string;
  text: string | null;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
  webLinks?: readonly TranscriptWebLink[];
  recordingSession?: IndexedClipRecordingSession | null;
  sceneOverride?: RecordingSessionScene | null;
}

/**
 * Renders the "on screen" annotation for the web links shown during a clip,
 * for inline injection right after the clip's `[N]` marker.
 *
 * Deduped globally across the transcript via `seenUrls`: a URL is only annotated
 * on its first appearance, so the writer is nudged to cite each page once. The
 * passed set is mutated with any newly-seen URLs. Returns "" when there is
 * nothing new to annotate.
 */
export function formatOnScreenLinks(
  webLinks: readonly TranscriptWebLink[] | undefined,
  seenUrls: Set<string>
): string {
  if (!webLinks || webLinks.length === 0) return "";
  const fresh: string[] = [];
  for (const link of webLinks) {
    if (seenUrls.has(link.url)) continue;
    seenUrls.add(link.url);
    fresh.push(link.title ? `${link.title} — ${link.url}` : link.url);
  }
  if (fresh.length === 0) return "";
  return `«on screen: ${fresh.join("; ")}» `;
}

/** The DiagramSnapshot a Clip pins, as the writer's transcript reads it. */
export interface TranscriptDiagramSnapshot {
  diagramId: string;
  /** The stored search text; `null` on a snapshot nobody backfilled. */
  searchText: string | null;
  scene: unknown;
  diagram: { name: string };
}

/** The shape text of a pinned DiagramSnapshot, plus whose Diagram it is. */
export interface ClipDiagramText {
  diagramId: string;
  diagramName: string;
  text: string;
}

export function toClipDiagramText(
  snapshot: TranscriptDiagramSnapshot | null | undefined
): ClipDiagramText | null {
  if (!snapshot) return null;
  const text = (snapshot.searchText ?? extractSceneText(snapshot.scene)).trim();
  if (!text) return null;
  return {
    diagramId: snapshot.diagramId,
    diagramName: snapshot.diagram.name,
    text,
  };
}

/**
 * Renders the "diagram" annotation for the DiagramSnapshot a clip pins, for
 * inline injection right after the clip's `[N]` marker.
 *
 * A Diagram is pinned to every clip filmed while it was on screen, and most of
 * its snapshots differ only in layout, so the text is annotated only when it
 * differs from the last text annotated for that Diagram. `shownText` (Diagram
 * id → last annotated text) is mutated. Returns "" when there is nothing new.
 */
export function formatOnScreenDiagram(
  diagram: ClipDiagramText | null,
  shownText: Map<string, string>
): string {
  if (!diagram) return "";
  if (shownText.get(diagram.diagramId) === diagram.text) return "";
  shownText.set(diagram.diagramId, diagram.text);
  return `«diagram "${diagram.diagramName}": ${diagram.text}» `;
}

export type ClipDiagramTextEntry = ClipDiagramText & { clipIndex: number };

/**
 * Every diagram annotation the writer's transcript can carry, in clip order,
 * keyed by the clip's `[N]` index. What the writer's context panel lists.
 */
export function listClipDiagramTexts(
  clips: readonly WriterTranscriptClip[]
): ClipDiagramTextEntry[] {
  const shownText = new Map<string, string>();
  const result: ClipDiagramTextEntry[] = [];
  sortByOrder([...clips]).forEach((clip, i) => {
    if (!clip.text) return;
    const diagram = toClipDiagramText(clip.diagramSnapshot);
    if (diagram && formatOnScreenDiagram(diagram, shownText)) {
      result.push({ ...diagram, clipIndex: i + 1 });
    }
  });
  return result;
}

export interface WriterTranscriptClip {
  order: string;
  text: string | null;
  webLinks?: readonly TranscriptWebLink[];
  diagramSnapshot?: TranscriptDiagramSnapshot | null;
}

/**
 * The transcript the writing agents are prompted with: every clip's text
 * behind its `[N]` marker, with its on-screen annotations, in paragraphs split
 * at the chapters. `enabledSections` trims it to those chapters (empty means
 * all of them); `includeDiagramText` adds the text of the diagram each clip
 * pins, right next to the clip it was on screen for.
 */
export function buildWriterTranscript(props: {
  clips: readonly WriterTranscriptClip[];
  chapters: readonly { id: string; order: string }[];
  enabledSections?: readonly string[];
  includeDiagramText?: boolean;
}): string {
  const enabledSectionIds = new Set(props.enabledSections ?? []);
  const allSectionsEnabled = enabledSectionIds.size === 0;

  const sortedAllItems = sortByOrder([
    ...props.clips.map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      clip,
    })),
    ...props.chapters.map((section) => ({
      type: "chapter" as const,
      order: section.order,
      section,
    })),
  ]);

  // Clips carry sequential 1-based indices for AI screenshot placement.
  const transcriptParts: string[] = [];
  let currentParagraph: string[] = [];
  // If no sections exist, include clips before the first section.
  let currentSectionEnabled = allSectionsEnabled;
  let clipIndex = 0;
  // On-screen web links are annotated inline once, on their first appearance.
  const seenUrls = new Set<string>();
  const shownDiagramText = new Map<string, string>();

  for (const item of sortedAllItems) {
    if (item.type === "chapter") {
      if (currentParagraph.length > 0 && currentSectionEnabled) {
        transcriptParts.push(currentParagraph.join(" "));
      }
      currentParagraph = [];
      currentSectionEnabled =
        allSectionsEnabled || enabledSectionIds.has(item.section.id);
    } else {
      clipIndex++;
      if (item.clip.text && currentSectionEnabled) {
        const onScreen = formatOnScreenLinks(item.clip.webLinks, seenUrls);
        const diagram = props.includeDiagramText
          ? formatOnScreenDiagram(
              toClipDiagramText(item.clip.diagramSnapshot),
              shownDiagramText
            )
          : "";
        currentParagraph.push(
          `[${clipIndex}] ${onScreen}${diagram}${item.clip.text}`
        );
      }
    }
  }

  if (currentParagraph.length > 0 && currentSectionEnabled) {
    transcriptParts.push(currentParagraph.join(" "));
  }

  return transcriptParts.join("\n\n").trim();
}

export interface ChapterInput {
  id: string;
  order: string;
  name: string;
}

export type TranscriptItem =
  { type: "clip"; text: string } | { type: "section"; name: string };

type OrderedItem =
  | {
      type: "clip";
      order: string;
      text: string | null;
      sourceStartTime: number;
      sourceEndTime: number;
      videoFilename: string;
      webLinks?: readonly TranscriptWebLink[];
      recordingSession?: IndexedClipRecordingSession | null;
      sceneOverride?: RecordingSessionScene | null;
    }
  | { type: "section"; order: string; id: string; name: string };

function toOrderedItems(
  clips: readonly ClipInput[],
  chapters: readonly ChapterInput[]
): OrderedItem[] {
  return sortByOrder<OrderedItem>([
    ...clips.map<OrderedItem>((clip) => ({
      type: "clip",
      order: clip.order,
      text: clip.text,
      sourceStartTime: clip.sourceStartTime,
      sourceEndTime: clip.sourceEndTime,
      videoFilename: clip.videoFilename,
      webLinks: clip.webLinks,
      recordingSession: clip.recordingSession,
      sceneOverride: clip.sceneOverride,
    })),
    ...chapters.map<OrderedItem>((section) => ({
      type: "section",
      order: section.order,
      id: section.id,
      name: section.name,
    })),
  ]);
}

export type ProjectionClipInput = {
  order: string;
  text: string | null;
};

export type ProjectionChapterInput = {
  order: string;
  name: string;
};

export function toTranscriptItems(
  clips: readonly ProjectionClipInput[],
  chapters: readonly ProjectionChapterInput[]
): TranscriptItem[] {
  const sorted = sortByOrder<
    | { kind: "clip"; order: string; text: string | null }
    | { kind: "section"; order: string; name: string }
  >([
    ...clips.map((c) => ({
      kind: "clip" as const,
      order: c.order,
      text: c.text,
    })),
    ...chapters.map((s) => ({
      kind: "section" as const,
      order: s.order,
      name: s.name,
    })),
  ]);

  const result: TranscriptItem[] = [];
  for (const item of sorted) {
    if (item.kind === "section") {
      result.push({ type: "section", name: item.name });
    } else if (item.text) {
      result.push({ type: "clip", text: item.text });
    }
  }
  return result;
}

export function formatProseTranscript(
  items: readonly TranscriptItem[]
): string {
  const parts: string[] = [];
  let currentParagraph: string[] = [];
  for (const item of items) {
    if (item.type === "section") {
      if (currentParagraph.length > 0) {
        parts.push(currentParagraph.join(" "));
        currentParagraph = [];
      }
      parts.push(`## ${item.name}`);
    } else {
      currentParagraph.push(item.text);
    }
  }
  if (currentParagraph.length > 0) {
    parts.push(currentParagraph.join(" "));
  }
  return parts.join("\n\n");
}

export function toDiffArray(items: readonly TranscriptItem[]): string[] {
  return items.map((item) =>
    item.type === "section" ? `## ${item.name}` : item.text
  );
}

export function buildTranscript(
  clips: readonly ClipInput[],
  chapters: readonly ChapterInput[]
): {
  indexedClips: IndexedClip[];
  transcript: string;
  wordCount: number;
  sections: SectionWithWordCount[];
} {
  const sortedItems = toOrderedItems(clips, chapters);

  const indexedClips: IndexedClip[] = [];
  const transcriptParts: string[] = [];
  let currentParagraph: string[] = [];
  let clipIndex = 0;

  const sections: SectionWithWordCount[] = [];
  let currentSectionIndex = -1;

  // URLs already annotated earlier in the transcript. A given page is only
  // called out on its first appearance so the writer cites it once.
  const seenUrls = new Set<string>();

  for (const item of sortedItems) {
    if (item.type === "section") {
      if (currentParagraph.length > 0) {
        transcriptParts.push(currentParagraph.join(" "));
        currentParagraph = [];
      }
      transcriptParts.push(`## ${item.name}`);
      currentSectionIndex = sections.length;
      sections.push({
        id: item.id,
        name: item.name,
        order: item.order,
        wordCount: 0,
      });
    } else {
      clipIndex++;
      indexedClips.push({
        index: clipIndex,
        sourceStartTime: item.sourceStartTime,
        sourceEndTime: item.sourceEndTime,
        videoFilename: item.videoFilename,
        text: item.text,
        ...(item.recordingSession && {
          recordingSession: item.recordingSession,
          sceneOverride: item.sceneOverride ?? null,
        }),
      });

      if (item.text) {
        const onScreen = formatOnScreenLinks(item.webLinks, seenUrls);
        currentParagraph.push(`[${clipIndex}] ${onScreen}${item.text}`);
        if (currentSectionIndex >= 0) {
          sections[currentSectionIndex]!.wordCount +=
            item.text.split(/\s+/).length;
        }
      }
    }
  }

  if (currentParagraph.length > 0) {
    transcriptParts.push(currentParagraph.join(" "));
  }

  const transcript = transcriptParts.join("\n\n").trim();
  const wordCount = transcript ? transcript.split(/\s+/).length : 0;

  return { indexedClips, transcript, wordCount, sections };
}
