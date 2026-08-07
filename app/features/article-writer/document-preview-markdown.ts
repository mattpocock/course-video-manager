/**
 * What the document preview actually parses.
 *
 * One entry point for every rewrite the preview needs, so the offsets the
 * remove buttons report can always be mapped back. Quizzes are always rewritten
 * — a body carrying one renders it whatever mode wrote it — while screenshot
 * placeholders only apply where clips exist to fill them.
 */

import { collectChooseScreenshotRewrites } from "./choose-screenshot-markdown";
import {
  applyPreviewRewrites,
  mapPreviewOffset,
  type PreviewRewrite,
} from "./preview-rewrites";
import { collectQuizRewrites } from "./quiz-markdown";

export interface DocumentPreviewOptions {
  /** Whether `<ChooseScreenshot>` placeholders are live for this document. */
  screenshots: boolean;
}

function collect(md: string, opts: DocumentPreviewOptions): PreviewRewrite[] {
  return [
    ...collectQuizRewrites(md),
    ...(opts.screenshots ? collectChooseScreenshotRewrites(md) : []),
  ];
}

export function preprocessDocumentPreview(
  md: string,
  opts: DocumentPreviewOptions
): string {
  return applyPreviewRewrites(md, collect(md, opts));
}

/**
 * Translates a preview offset back to the stored document.
 *
 * Returns `undefined` for an offset inside a rewritten span — a quiz is cut by
 * its own button at a known source range, never by a block range that happens
 * to overlap it.
 */
export function mapDocumentPreviewOffsetToSource(
  md: string,
  offset: number,
  opts: DocumentPreviewOptions
): number | undefined {
  const mapped = mapPreviewOffset(collect(md, opts), offset);
  return mapped.inside ? undefined : mapped.source;
}
