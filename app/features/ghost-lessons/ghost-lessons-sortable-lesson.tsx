import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { BookOpen, FileVideo, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Lesson,
  Section,
  FlatLesson,
  Action,
} from "./ghost-lessons-reducer";
import {
  checkDependencyViolation,
  formatDuration,
} from "./ghost-lessons-reducer";
import {
  LessonIconBadge,
  PriorityBadge,
  FsStatusBadge,
  InlineDependencySelector,
} from "./ghost-lessons-components";

export function SortableLessonItem({
  lesson,
  lessonIndex,
  section,
  allFlatLessons,
  dispatch,
}: {
  lesson: Lesson;
  lessonIndex: number;
  section: Section;
  allFlatLessons: FlatLesson[];
  dispatch: React.Dispatch<Action>;
}) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(lesson.title);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lesson.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const violations = checkDependencyViolation(lesson, allFlatLessons);
  const sectionIndex =
    allFlatLessons.find((l) => l.sectionId === section.id)?.sectionNumber ?? 1;
  const lessonNumber = `${sectionIndex}.${lessonIndex + 1}`;
  const isGhost = lesson.fsStatus === "ghost";

  return (
    <div ref={setNodeRef} style={style}>
      {lessonIndex > 0 && <Separator className="my-1" />}
      <div
        className={cn(
          "rounded-md px-2 py-2 group",
          isGhost &&
            "border border-dashed border-muted-foreground/30 bg-muted/20"
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="cursor-context-menu">
              <div className="flex items-start gap-2">
                {/* Drag handle */}
                <button
                  className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 mt-1 touch-none"
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </button>

                {/* Icon badge */}
                <LessonIconBadge
                  icon={lesson.icon}
                  fsStatus={lesson.fsStatus}
                  onClick={() =>
                    dispatch({
                      type: "toggle-icon",
                      sectionId: section.id,
                      lessonId: lesson.id,
                    })
                  }
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingTitle ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          className="text-sm h-7"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              dispatch({
                                type: "update-title",
                                sectionId: section.id,
                                lessonId: lesson.id,
                                title: titleDraft,
                              });
                              setEditingTitle(false);
                            }
                            if (e.key === "Escape") {
                              setTitleDraft(lesson.title);
                              setEditingTitle(false);
                            }
                          }}
                          onBlur={() => {
                            dispatch({
                              type: "update-title",
                              sectionId: section.id,
                              lessonId: lesson.id,
                              title: titleDraft,
                            });
                            setEditingTitle(false);
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "text-sm text-muted-foreground",
                            isGhost && "text-muted-foreground/50"
                          )}
                        >
                          {lessonNumber}
                        </span>
                        <span
                          className={cn(
                            "text-sm font-medium cursor-pointer hover:text-muted-foreground transition-colors",
                            isGhost && "text-muted-foreground/70 italic"
                          )}
                          onClick={() => {
                            setTitleDraft(lesson.title);
                            setEditingTitle(true);
                          }}
                        >
                          {lesson.title}
                        </span>
                      </>
                    )}

                    {!editingTitle && (
                      <>
                        <FsStatusBadge fsStatus={lesson.fsStatus} />
                        <InlineDependencySelector
                          lessonId={lesson.id}
                          dependencies={lesson.dependencies}
                          allLessons={allFlatLessons}
                          violations={violations}
                          onDependenciesChange={(deps) =>
                            dispatch({
                              type: "update-dependencies",
                              sectionId: section.id,
                              lessonId: lesson.id,
                              dependencies: deps,
                            })
                          }
                        />
                        <PriorityBadge
                          priority={lesson.priority}
                          onClick={() =>
                            dispatch({
                              type: "toggle-priority",
                              sectionId: section.id,
                              lessonId: lesson.id,
                            })
                          }
                        />
                      </>
                    )}
                  </div>

                  {/* Description */}
                  {editingDesc ? (
                    <div className="mt-2">
                      <Textarea
                        value={lesson.description}
                        onChange={(e) =>
                          dispatch({
                            type: "update-description",
                            sectionId: section.id,
                            lessonId: lesson.id,
                            description: e.target.value,
                          })
                        }
                        placeholder="What should this lesson teach?"
                        className="text-sm min-h-[60px]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingDesc(false);
                          if (e.key === "Enter" && e.ctrlKey)
                            setEditingDesc(false);
                        }}
                        onBlur={() => setEditingDesc(false)}
                      />
                    </div>
                  ) : lesson.description ? (
                    <div
                      className="text-xs text-muted-foreground mt-1 cursor-pointer hover:text-foreground/70 transition-colors line-clamp-2 whitespace-pre-line"
                      onClick={() => setEditingDesc(true)}
                    >
                      {lesson.description}
                    </div>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground/50 mt-1 hover:text-muted-foreground transition-colors"
                      onClick={() => setEditingDesc(true)}
                    >
                      + Add description
                    </button>
                  )}

                  {/* Videos for real lessons */}
                  {lesson.videos && lesson.videos.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {lesson.videos.map((video) => (
                        <div
                          key={video.id}
                          className="flex items-center justify-between text-xs py-0.5 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileVideo className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="truncate text-muted-foreground">
                              {video.title}
                            </span>
                          </div>
                          <span className="text-muted-foreground/70 font-mono ml-2 shrink-0">
                            {formatDuration(video.durationSeconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {isGhost && (
              <>
                <ContextMenuItem
                  onSelect={() =>
                    dispatch({
                      type: "realize-lesson",
                      sectionId: section.id,
                      lessonId: lesson.id,
                    })
                  }
                >
                  <BookOpen className="w-4 h-4" />
                  Create on Disk
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              onSelect={() => {
                setTitleDraft(lesson.title);
                setEditingTitle(true);
              }}
            >
              <BookOpen className="w-4 h-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setEditingDesc(true)}>
              <Plus className="w-4 h-4" />
              Edit Description
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() =>
                dispatch({
                  type: "delete-lesson",
                  sectionId: section.id,
                  lessonId: lesson.id,
                })
              }
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  );
}
