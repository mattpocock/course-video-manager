/**
 * The shapes the Transcript builder hands back.
 *
 * They live here rather than with the article writer's UI types because
 * `transcript-builder.ts` is read by the domain operations, and the domain
 * cannot reach into the writer — the writer's types module pulls in the AI SDK
 * and the writing agents. The writer re-exports these so its own callers see
 * one vocabulary.
 */

/** Chapters with calculated word counts, for UI display. */
export type SectionWithWordCount = {
  id: string;
  name: string;
  order: string;
  wordCount: number;
};

/** A Clip paired with the `[N]` marker index it carries in the Transcript. */
export type IndexedClip = {
  index: number;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
  text: string | null;
};
