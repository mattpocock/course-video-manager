import { useState, useCallback, useEffect } from "react";
import type { FrontendId, TimelineItem } from "../clip-state-reducer.types";
import type { ChapterNamingModal } from "../types";

export const useChapterModal = (
  timelineItems: TimelineItem[],
  selectedClipsSet: Set<FrontendId>,
  onAddChapter: (name: string) => void
) => {
  const [chapterNamingModal, setChapterNamingModal] =
    useState<ChapterNamingModal>(null);

  const generateDefaultChapterName = useCallback(() => {
    const existingChapterCount = timelineItems.filter(
      (item) =>
        item.type === "chapter-on-database" ||
        item.type === "chapter-optimistically-added"
    ).length;
    return `Chapter ${existingChapterCount + 1}`;
  }, [timelineItems]);

  const onEditChapter = useCallback(
    (chapterId: FrontendId, currentName: string) => {
      setChapterNamingModal({
        mode: "edit",
        chapterId,
        currentName,
      });
    },
    []
  );

  const onAddChapterBefore = useCallback(
    (itemId: FrontendId, defaultName: string) => {
      setChapterNamingModal({
        mode: "add-at",
        position: "before",
        itemId,
        defaultName,
      });
    },
    []
  );

  const onAddChapterAfter = useCallback(
    (itemId: FrontendId, defaultName: string) => {
      setChapterNamingModal({
        mode: "add-at",
        position: "after",
        itemId,
        defaultName,
      });
    },
    []
  );

  const onAddIntroChapter = useCallback(() => {
    onAddChapter("Intro");
  }, [onAddChapter]);

  const onOpenCreateChapterModal = useCallback(() => {
    setChapterNamingModal({
      mode: "create",
      defaultName: generateDefaultChapterName(),
    });
  }, [generateDefaultChapterName]);

  useEffect(() => {
    const handleF2 = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLButtonElement &&
          !e.target.classList.contains("allow-keydown"))
      ) {
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        if (selectedClipsSet.size !== 1) return;
        const selectedId = Array.from(selectedClipsSet)[0]!;
        const selectedItem = timelineItems.find(
          (item) => item.frontendId === selectedId
        );
        if (
          selectedItem &&
          (selectedItem.type === "chapter-on-database" ||
            selectedItem.type === "chapter-optimistically-added")
        ) {
          onEditChapter(selectedId, selectedItem.name);
        }
      }
    };
    window.addEventListener("keydown", handleF2);
    return () => window.removeEventListener("keydown", handleF2);
  }, [selectedClipsSet, timelineItems, onEditChapter]);

  return {
    chapterNamingModal,
    setChapterNamingModal,
    generateDefaultChapterName,
    onEditChapter,
    onAddChapterBefore,
    onAddChapterAfter,
    onAddIntroChapter,
    onOpenCreateChapterModal,
  };
};
