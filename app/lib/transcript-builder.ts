import { sortByOrder } from "@/lib/sort-by-order";
import type {
  IndexedClip,
  SectionWithWordCount,
} from "@/features/article-writer/types";

export interface ClipInput {
  order: string;
  text: string | null;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
}

export interface ChapterInput {
  id: string;
  order: string;
  name: string;
}

export type TranscriptItem =
  | { type: "clip"; text: string }
  | { type: "section"; name: string };

type OrderedItem =
  | {
      type: "clip";
      order: string;
      text: string | null;
      sourceStartTime: number;
      sourceEndTime: number;
      videoFilename: string;
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
      });

      if (item.text) {
        currentParagraph.push(`[${clipIndex}] ${item.text}`);
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
