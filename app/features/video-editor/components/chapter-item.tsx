import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type { Chapter } from "../clip-state-reducer";
import { ChapterDivider } from "./chapter-divider";
import { InsertionPointWithSession } from "./insertion-point-with-session";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

/**
 * ChapterItem component displays a chapter divider with context menu
 * in the video editor timeline.
 */
export const ChapterItem = (props: {
  chapter: Chapter;
  isFirstItem: boolean;
  isLastItem: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onEditChapter: () => void;
  onAddChapterBefore: () => void;
  onAddChapterAfter: () => void;
}) => {
  // Use context selectors
  const isSelected = useContextSelector(VideoEditorContext, (ctx) =>
    ctx.selectedClipsSet.has(props.chapter.frontendId)
  );
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const onSetInsertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onSetInsertionPoint
  );
  const onMoveClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onMoveClip
  );
  const setIsCreateVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsCreateVideoModalOpen
  );
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ChapterDivider
            id={`chapter-${props.chapter.frontendId}`}
            name={props.chapter.name}
            isSelected={isSelected}
            isCollapsed={props.isCollapsed}
            onToggleCollapse={props.onToggleCollapse}
            onClick={(e) => {
              // If already selected and clicked again (without modifiers),
              // play from the next clip after this section
              if (
                !e.ctrlKey &&
                !e.shiftKey &&
                selectedClipsSet.has(props.chapter.frontendId) &&
                selectedClipsSet.size === 1
              ) {
                dispatch({
                  type: "play-from-chapter",
                  chapterId: props.chapter.frontendId,
                });
                return;
              }
              dispatch({
                type: "click-clip",
                clipId: props.chapter.frontendId,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
              });
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              onSetInsertionPoint("before", props.chapter.frontendId);
            }}
          >
            <ChevronLeftIcon />
            Insert Before
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              onSetInsertionPoint("after", props.chapter.frontendId);
            }}
          >
            <ChevronRightIcon />
            Insert After
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={props.onAddChapterBefore}>
            <PlusIcon />
            Add Chapter Before
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onAddChapterAfter}>
            <PlusIcon />
            Add Chapter After
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={props.onEditChapter}>
            <PencilIcon />
            Edit
          </ContextMenuItem>
          <ContextMenuItem
            disabled={props.isFirstItem}
            onSelect={() => {
              onMoveClip(props.chapter.frontendId, "up");
            }}
          >
            <ArrowUpIcon />
            Move Up
          </ContextMenuItem>
          <ContextMenuItem
            disabled={props.isLastItem}
            onSelect={() => {
              onMoveClip(props.chapter.frontendId, "down");
            }}
          >
            <ArrowDownIcon />
            Move Down
          </ContextMenuItem>
          {selectedClipsSet.size > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  setIsCreateVideoModalOpen(true);
                }}
              >
                <FilmIcon />
                Create New Video from Selection
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              dispatch({
                type: "delete-clip",
                clipId: props.chapter.frontendId,
              });
            }}
          >
            <Trash2Icon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {insertionPoint.type === "after-chapter" &&
        insertionPoint.frontendChapterId === props.chapter.frontendId && (
          <InsertionPointWithSession />
        )}
    </div>
  );
};
