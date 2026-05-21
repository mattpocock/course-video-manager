import type { TextWritingAgentMode } from "@/routes/videos.$videoId.completions";
import type {
  writeDocumentTool,
  editDocumentTool,
} from "@/services/document-writing-agent";
import type { InferUITools, UIMessage } from "ai";

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
