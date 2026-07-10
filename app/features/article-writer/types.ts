import type { TextWritingAgentMode } from "@/routes/videos.$videoId.completions";
import type {
  writeDocumentTool,
  editDocumentTool,
} from "@/services/document-writing-agent";
import type { InferUITools, UIMessage } from "ai";
import type { BeatKind } from "@/features/beats/beat-kinds";

export type DocumentAgentTools = {
  writeDocument: typeof writeDocumentTool;
  editDocument: typeof editDocumentTool;
};

export type DocumentAgentMessage = UIMessage<
  unknown,
  never,
  InferUITools<DocumentAgentTools>
>;

/**
 * Represents chapters with calculated word counts for UI display.
 * Used in the write page to show section checkboxes with word counts.
 */
export type SectionWithWordCount = {
  id: string;
  name: string;
  order: string;
  wordCount: number;
};

/**
 * Writing mode for the article writer.
 * Inferred from the schema definition to ensure type safety.
 */
export type Mode = TextWritingAgentMode;

/**
 * AI model selection for article generation.
 */
export type Model = "claude-sonnet-4-5" | "claude-haiku-4-5" | "auto";

/**
 * Indexed clip data passed to the client for ChooseScreenshot component.
 */
export type IndexedClip = {
  index: number;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
  text: string | null;
};

export interface WriterContext {
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  transcript: string;
  transcriptWordCount: number;
  chapters: SectionWithWordCount[];
  indexedClips: IndexedClip[];
  links: Array<{ id: string; url: string; title: string }>;
  courseStructure: {
    repoName: string;
    currentSectionPath: string;
    currentLessonPath: string;
    sections: {
      path: string;
      lessons: { path: string; description?: string }[];
    }[];
  } | null;
  memory: string;
  repoId: string | null;
  fullPath: string;
  isStandalone: boolean;
  beats: Array<{ kind: BeatKind; title: string; description: string }>;
}
