import type { TextWritingAgentMode } from "@/routes/videos.$videoId.completions";
import type {
  writeDocumentTool,
  editDocumentTool,
} from "@/services/document-writing-agent";
import type { InferUITools, UIMessage } from "ai";
import type {
  IndexedClip,
  SectionWithWordCount,
} from "@cvm/core/lib/transcript-types";
import type { BeatKind } from "@/features/beats/beat-kinds";

export type DocumentAgentTools = {
  writeDocument: typeof writeDocumentTool;
  editDocument: typeof editDocumentTool;
};

/**
 * Prompt-cache counts for one assistant message, sent down from the server.
 *
 * A cache miss produces no error — it just bills the full prefix — so these
 * counts are the only signal that the breakpoints are still working.
 */
export type WriterCacheStats = {
  /** Prefix tokens served from cache. Large means a hit. */
  cacheReadTokens: number;
  /** Prefix tokens written to cache. Large on the first request of a session. */
  cacheWriteTokens: number;
  /** Tokens billed at full price because nothing cached them. */
  noCacheTokens: number;
};

export type DocumentAgentMessage = UIMessage<
  WriterCacheStats,
  never,
  InferUITools<DocumentAgentTools>
>;

/**
 * The Transcript builder's own shapes. Declared in `@cvm/core` because the
 * domain operations that build a Transcript cannot reach into this module, and
 * re-exported here so the writer's callers keep one import site.
 */
export type {
  SectionWithWordCount,
  IndexedClip,
} from "@cvm/core/lib/transcript-types";

/**
 * Writing mode for the article writer.
 * Inferred from the schema definition to ensure type safety.
 */
export type Mode = TextWritingAgentMode;

/**
 * The writer's sub-view. `"writer"` is the default the writer opens on.
 */
export type WriterView = "writer" | "context" | "settings";

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
  /** Quiz ids owned by other videos in this course — none of them are free. */
  quizIds?: string[];
}
