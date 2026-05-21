import { useMemo } from "react";
import { BeatIndicator } from "./timeline-indicators";
import { ClipItem } from "./clip-item";
import { ChapterItem } from "./chapter-item";
import { PreRecordingChecklist } from "./pre-recording-checklist";
import { InlineSuggestion } from "./inline-suggestion";
import { InsertionPointWithSession } from "./insertion-point-with-session";
import { isChapter } from "../clip-utils";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { FrontendId } from "../clip-state-reducer";

/**
 * ClipTimeline component displays the main timeline of clips and chapters.
 *
 * Handles rendering:
 * - Pre-recording checklist (when no clips exist)
 * - Insertion point indicators (start/end/after-clip positions)
 * - Chapters (with full interactivity)
 * - Clips (with full interactivity)
 * - Beat indicators between clips
 */
export const ClipTimeline = () => {
  // Use context selectors for state needed by this component
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const clipComputedProps = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipComputedProps
  );
  const generateDefaultChapterName = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.generateDefaultChapterName
  );
  const onEditChapter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onEditChapter
  );
  const onAddChapterBefore = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapterBefore
  );
  const onAddChapterAfter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapterAfter
  );
  const sessions = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.sessions
  );
  const allItems = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allItems
  );
  const onOpenCreateChapterModal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onOpenCreateChapterModal
  );

  /**
   * When the insertion point references an optimistic clip (filtered out of
   * `items`), compute the frontendId of the last non-optimistic item that
   * appears before it in the full item list. This is the "visual anchor" —
   * the filtered timeline item after which we render InsertionPointWithSession.
   * Returns null when the insertion point is at the start/end or already
   * references a clip present in the filtered timeline.
   */
  const visualAnchorId = useMemo((): FrontendId | null => {
    if (insertionPoint.type !== "after-clip") return null;
    if (items.some((item) => item.frontendId === insertionPoint.frontendClipId))
      return null;

    // Insertion point references an item not in filtered timeline (optimistic clip)
    const optIndex = allItems.findIndex(
      (i) => i.frontendId === insertionPoint.frontendClipId
    );
    if (optIndex === -1) return null;

    const lastNonOptimistic = allItems
      .slice(0, optIndex)
      .findLast(
        (i) =>
          i.type !== "optimistically-added" &&
          i.type !== "effect-clip-optimistically-added" &&
          i.type !== "chapter-optimistically-added"
      );

    return lastNonOptimistic?.frontendId ?? null;
  }, [insertionPoint, items, allItems]);

  return (
    <div className="lg:flex-1 flex gap-2 h-full order-2 lg:order-1 overflow-y-auto">
      <div className="grid gap-4 w-full p-2 content-start">
        {clips.length === 0 && sessions.length === 0 && (
          <>
            <PreRecordingChecklist />
            <Button
              variant="outline"
              className="w-full"
              onClick={onOpenCreateChapterModal}
            >
              <Plus className="size-4 mr-2" />
              Add Chapter
            </Button>
          </>
        )}

        {items.length > 0 && (
          <>
            {insertionPoint.type === "start" && <InsertionPointWithSession />}
            {items.map((item, itemIndex) => {
              const isFirstItem = itemIndex === 0;
              const isLastItem = itemIndex === items.length - 1;

              // Render chapter divider
              if (isChapter(item)) {
                return (
                  <div key={item.frontendId}>
                    <ChapterItem
                      chapter={item}
                      isFirstItem={isFirstItem}
                      isLastItem={isLastItem}
                      onEditChapter={() => {
                        onEditChapter(item.frontendId, item.name);
                      }}
                      onAddChapterBefore={() => {
                        onAddChapterBefore(
                          item.frontendId,
                          generateDefaultChapterName()
                        );
                      }}
                      onAddChapterAfter={() => {
                        onAddChapterAfter(
                          item.frontendId,
                          generateDefaultChapterName()
                        );
                      }}
                    />
                    {visualAnchorId === item.frontendId && (
                      <InsertionPointWithSession />
                    )}
                  </div>
                );
              }

              // Render clip
              const clip = item;
              const computedProps = clipComputedProps.get(clip.frontendId);
              const timecode = computedProps?.timecode ?? "";
              const nextLevenshtein = computedProps?.nextLevenshtein ?? 0;

              return (
                <div key={clip.frontendId}>
                  <ClipItem
                    clip={clip}
                    isFirstItem={isFirstItem}
                    isLastItem={isLastItem}
                    timecode={timecode}
                    nextLevenshtein={nextLevenshtein}
                    onAddChapterBefore={() => {
                      onAddChapterBefore(
                        clip.frontendId,
                        generateDefaultChapterName()
                      );
                    }}
                    onAddChapterAfter={() => {
                      onAddChapterAfter(
                        clip.frontendId,
                        generateDefaultChapterName()
                      );
                    }}
                  />
                  {/* Beat indicator dots below clip */}
                  {clip.beatType === "long" && <BeatIndicator />}
                  {/* Render insertion point after this clip when it is the direct or visual anchor */}
                  {((insertionPoint.type === "after-clip" &&
                    insertionPoint.frontendClipId === clip.frontendId) ||
                    visualAnchorId === clip.frontendId) && (
                    <InsertionPointWithSession />
                  )}
                </div>
              );
            })}

            {/* When insertion point references an optimistic clip with no preceding
                non-optimistic item, show at top (handled by start case above) or
                fall back to end if visual anchor is null and clip not found */}
            {insertionPoint.type === "after-clip" &&
              !items.some(
                (item) => item.frontendId === insertionPoint.frontendClipId
              ) &&
              visualAnchorId === null && <InsertionPointWithSession />}

            {insertionPoint.type === "end" && <InsertionPointWithSession />}
          </>
        )}

        {items.length === 0 && sessions.length > 0 && (
          <InsertionPointWithSession />
        )}

        {/* Inline suggestion display at the bottom of the timeline */}
        <InlineSuggestion />
      </div>
    </div>
  );
};
