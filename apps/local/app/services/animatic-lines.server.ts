import { Effect } from "effect";
import { buildAnimaticLines } from "@/features/animatic/animatic-lines";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";

/**
 * A Video's Animatic read as lines — both nouns and their comments, read and merged in one place
 * for the Teleprompter's content poll and the Video Editor's Animatic tab.
 */
export const loadAnimaticLines = (videoId: string) =>
  Effect.gen(function* () {
    const clipMockupOps = yield* ClipMockupOperationsService;
    const chapterOps = yield* ClipMockupChapterOperationsService;
    const commentOps = yield* ClipMockupCommentOperationsService;

    const [clipMockups, chapters, comments] = yield* Effect.all(
      [
        clipMockupOps.listClipMockupsByVideoId(videoId),
        chapterOps.listClipMockupChaptersByVideoId(videoId),
        commentOps.listClipMockupCommentsByVideoId(videoId),
      ],
      { concurrency: "unbounded" }
    );

    return buildAnimaticLines({ clipMockups, chapters, comments });
  });
