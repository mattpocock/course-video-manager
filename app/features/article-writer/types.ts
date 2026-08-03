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
 * The writer's sub-view. `"writer"` is the default the writer opens on.
 */
export type WriterView = "writer" | "context" | "settings";

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

/**
 * A screenshot the judge has proposed for one ChooseScreenshot block.
 *
 * Held in React state only, never written into the document — the tag is not
 * replaced by an image until Matt hits Apply, so a proposal is free to be
 * wrong. `absoluteImagePath` is the already-captured preview frame, served
 * through `/view-image`; `imagePath` is the document-relative form written
 * into the markdown on Apply.
 */
export type ScreenshotProposal =
  | {
      found: true;
      timestamp: number;
      clipIndex: number;
      reason: string;
      imagePath: string;
      absoluteImagePath: string;
    }
  | { found: false; reason: string };

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
  /** The video's script — the base Matt improvised from. Empty when unwritten. */
  script: string;
}
