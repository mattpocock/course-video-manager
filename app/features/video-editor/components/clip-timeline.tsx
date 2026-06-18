import { useEffect, useMemo, useState } from "react";
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
import { ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import type { FrontendId } from "../clip-state-reducer";
import { getChapterForClip, getChapters } from "../video-editor-selectors";

export const ClipTimeline = () => {
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
  const currentClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipId
  );

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const chapters = useMemo(() => getChapters(items), [items]);
  const chapterIds = useMemo(
    () => chapters.map((ch) => ch.frontendId),
    [chapters]
  );
  const allCollapsed =
    chapterIds.length > 0 && chapterIds.every((id) => collapsed[id as string]);

  const toggleCollapsed = (chapterId: FrontendId) =>
    setCollapsed((prev) => ({
      ...prev,
      [chapterId as string]: !prev[chapterId as string],
    }));

  const toggleAll = () => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const id of chapterIds) next[id as string] = !allCollapsed;
      return next;
    });
  };

  useEffect(() => {
    if (!currentClipId) return;
    const chapter = getChapterForClip(items, currentClipId);
    if (chapter && collapsed[chapter.frontendId as string]) {
      setCollapsed((prev) => ({
        ...prev,
        [chapter.frontendId as string]: false,
      }));
    }
  }, [currentClipId, items]);

  const visualAnchorId = useMemo((): FrontendId | null => {
    if (insertionPoint.type !== "after-clip") return null;
    if (items.some((item) => item.frontendId === insertionPoint.frontendClipId))
      return null;

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
            {chapterIds.length > 0 && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0"
                  onClick={toggleAll}
                  aria-label={
                    allCollapsed
                      ? "Expand all chapters"
                      : "Collapse all chapters"
                  }
                >
                  {allCollapsed ? (
                    <ChevronsUpDown className="size-3" />
                  ) : (
                    <ChevronsDownUp className="size-3" />
                  )}
                </Button>
              </div>
            )}
            {insertionPoint.type === "start" && <InsertionPointWithSession />}
            {(() => {
              let currentChapterId: FrontendId | undefined;
              return items.map((item, itemIndex) => {
                const isFirstItem = itemIndex === 0;
                const isLastItem = itemIndex === items.length - 1;

                if (isChapter(item)) {
                  currentChapterId = item.frontendId;
                  return (
                    <div key={item.frontendId}>
                      <ChapterItem
                        chapter={item}
                        isFirstItem={isFirstItem}
                        isLastItem={isLastItem}
                        isCollapsed={
                          collapsed[item.frontendId as string] ?? false
                        }
                        onToggleCollapse={() =>
                          toggleCollapsed(item.frontendId)
                        }
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

                const isChapterCollapsed =
                  currentChapterId !== undefined &&
                  (collapsed[currentChapterId as string] ?? false);
                if (isChapterCollapsed) return null;

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
                    {clip.beatType === "long" && <BeatIndicator />}
                    {((insertionPoint.type === "after-clip" &&
                      insertionPoint.frontendClipId === clip.frontendId) ||
                      visualAnchorId === clip.frontendId) && (
                      <InsertionPointWithSession />
                    )}
                  </div>
                );
              });
            })()}

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

        <InlineSuggestion />
      </div>
    </div>
  );
};
