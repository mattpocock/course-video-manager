import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { formatSecondsToTimeCode } from "@/services/utils";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Console, Effect } from "effect";
import { GripVertical, Loader2, Plus, Trash2, VideoIcon } from "lucide-react";
import { buildQueueTreeLines } from "@/lib/queue-tree";
import { useState, useCallback } from "react";
import { data, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.videos.concatenate";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Concatenate Videos" }];
};

interface VideoItem {
  id: string;
  path: string;
  duration: number;
  contextParts?: string[];
}

interface CourseVideoSection {
  sectionPath: string;
  lessons: {
    lessonPath: string;
    videos: VideoItem[];
  }[];
}

interface CourseSource {
  id: string;
  name: string;
  sections: CourseVideoSection[];
}

const computeDuration = (
  clips: { sourceStartTime: number; sourceEndTime: number }[]
) => clips.reduce((acc, c) => acc + (c.sourceEndTime - c.sourceStartTime), 0);

export const loader = async () => {
  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;
    const [videos, courseList] = yield* Effect.all(
      [videoOps.getAllStandaloneVideos(), courseOps.getCourses()],
      { concurrency: "unbounded" }
    );

    // Load all courses with their sections/lessons/videos (draft version) in parallel
    const fullCourses = yield* Effect.all(
      courseList.map((course) =>
        courseOps.getCourseWithSectionsById(course.id)
      ),
      { concurrency: "unbounded" }
    );

    const courseSources: CourseSource[] = [];
    for (let i = 0; i < courseList.length; i++) {
      const course = courseList[i]!;
      const full = fullCourses[i]!;
      const draftVersion = full.versions[0];
      if (!draftVersion) continue;

      const sections: CourseVideoSection[] = [];
      for (const section of draftVersion.sections) {
        const lessons: CourseVideoSection["lessons"] = [];
        for (const lesson of section.lessons) {
          const lessonVideos: VideoItem[] = lesson.videos.map((v) => ({
            id: v.id,
            path: v.path,
            duration: computeDuration(v.clips),
            contextParts: [course.name, section.path, lesson.path],
          }));
          if (lessonVideos.length > 0) {
            lessons.push({
              lessonPath: lesson.path,
              videos: lessonVideos,
            });
          }
        }
        if (lessons.length > 0) {
          sections.push({ sectionPath: section.path, lessons });
        }
      }
      if (sections.length > 0) {
        courseSources.push({ id: course.id, name: course.name, sections });
      }
    }

    return {
      videos: videos.map((v) => ({
        id: v.id,
        path: v.path,
        duration: computeDuration(v.clips),
      })),
      courseSources,
      courses: courseList,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

interface QueueItem {
  id: string;
  path: string;
  duration: number;
  contextParts?: string[];
}

function SortableQueueItem({
  item,
  onRemove,
}: {
  item: QueueItem;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const treeLines = buildQueueTreeLines(item.contextParts, item.path);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 border rounded-lg px-3 py-2 bg-background"
    >
      <button
        className="cursor-grab text-muted-foreground hover:text-foreground mt-0.5"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        {treeLines.map((line, i) => (
          <div
            key={i}
            className="flex items-baseline gap-1"
            style={{ paddingLeft: `${line.level * 12}px` }}
          >
            {line.level > 0 && (
              <span className="text-muted-foreground text-xs select-none">
                └
              </span>
            )}
            {line.isVideo ? (
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm font-medium break-all">
                  {line.label}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatSecondsToTimeCode(item.duration)}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground break-all">
                {line.label}
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive mt-0.5"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function VideoRow({
  video,
  onAdd,
  isInQueue,
}: {
  video: QueueItem;
  onAdd: (video: QueueItem) => void;
  isInQueue: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <VideoIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm break-all">{video.path}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {formatSecondsToTimeCode(video.duration)}
        </span>
      </div>
      {!isInQueue && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAdd(video)}
          className="ml-2 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add
        </Button>
      )}
    </div>
  );
}

function CourseVideoList({
  course,
  queueIds,
  onAdd,
}: {
  course: CourseSource;
  queueIds: Set<string>;
  onAdd: (video: QueueItem) => void;
}) {
  const availableCount = course.sections.reduce(
    (acc, s) =>
      acc +
      s.lessons.reduce(
        (a, l) => a + l.videos.filter((v) => !queueIds.has(v.id)).length,
        0
      ),
    0
  );
  const totalCount = course.sections.reduce(
    (acc, s) => acc + s.lessons.reduce((a, l) => a + l.videos.length, 0),
    0
  );

  if (totalCount === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No videos in this course
      </p>
    );
  }

  if (availableCount === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        All videos added to queue
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {course.sections.map((section) => {
        const hasAvailable = section.lessons.some((l) =>
          l.videos.some((v) => !queueIds.has(v.id))
        );
        if (!hasAvailable) return null;
        return (
          <div key={section.sectionPath}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-3">
              {section.sectionPath}
            </div>
            {section.lessons.map((lesson) => {
              const availableVideos = lesson.videos.filter(
                (v) => !queueIds.has(v.id)
              );
              if (availableVideos.length === 0) return null;
              return (
                <div key={lesson.lessonPath} className="mb-2">
                  <div className="text-xs text-muted-foreground px-3 mb-0.5">
                    {lesson.lessonPath}
                  </div>
                  <div className="space-y-1">
                    {availableVideos.map((video) => (
                      <VideoRow
                        key={video.id}
                        video={video}
                        onAdd={onAdd}
                        isInQueue={false}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function Component({ loaderData }: Route.ComponentProps) {
  const { videos, courseSources } = loaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialVideoId = searchParams.get("initial");

  // Build a flat lookup of all videos (standalone + course) for initial video resolution
  const allVideosMap = new Map<string, QueueItem>();
  for (const v of videos) {
    allVideosMap.set(v.id, v);
  }
  for (const course of courseSources) {
    for (const section of course.sections) {
      for (const lesson of section.lessons) {
        for (const v of lesson.videos) {
          allVideosMap.set(v.id, v);
        }
      }
    }
  }

  // Initialize queue with the initial video if provided
  const initialQueue: QueueItem[] = [];
  if (initialVideoId) {
    const initialVideo = allVideosMap.get(initialVideoId);
    if (initialVideo) {
      initialQueue.push(initialVideo);
    }
  }

  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [name, setName] = useState(initialQueue[0]?.path ?? "");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>("standalone");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setQueue((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);

  const addToQueue = useCallback(
    (video: QueueItem) => {
      setQueue((prev) => [...prev, video]);
      if (queue.length === 0 && name === "") {
        setName(video.path);
      }
    },
    [queue.length, name]
  );

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleCreate = async () => {
    if (queue.length === 0 || !name.trim()) return;
    setIsCreating(true);
    try {
      const response = await fetch("/api/videos/concatenate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sourceVideoIds: queue.map((v) => v.id),
        }),
      });
      const result = await response.json();
      if (result.id) {
        navigate(`/videos/${result.id}/edit`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  // Videos that are available to add (not already in queue)
  const queueIds = new Set(queue.map((q) => q.id));
  const availableStandaloneVideos = videos.filter((v) => !queueIds.has(v.id));
  const selectedCourse = courseSources.find((c) => c.id === selectedSource);

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="border-b px-6 py-4">
          <h1 className="text-xl font-bold">Concatenate Videos</h1>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left column: Source selector */}
          <div className="w-48 border-r overflow-y-auto p-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Sources
            </div>
            <div className="space-y-1">
              {courseSources.map((course) => (
                <button
                  key={course.id}
                  onClick={() => setSelectedSource(course.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium truncate ${
                    selectedSource === course.id
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {course.name}
                </button>
              ))}
              <button
                onClick={() => setSelectedSource("standalone")}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                  selectedSource === "standalone"
                    ? "bg-muted"
                    : "hover:bg-muted/50"
                }`}
              >
                Standalone
              </button>
            </div>
          </div>

          {/* Middle column: Available videos */}
          <div className="flex-1 border-r overflow-y-auto p-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Available Videos
            </div>
            {selectedSource === "standalone" ? (
              availableStandaloneVideos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {videos.length === 0
                    ? "No standalone videos"
                    : "All videos added to queue"}
                </p>
              ) : (
                <div className="space-y-1">
                  {availableStandaloneVideos.map((video) => (
                    <VideoRow
                      key={video.id}
                      video={video}
                      onAdd={addToQueue}
                      isInQueue={false}
                    />
                  ))}
                </div>
              )
            ) : selectedCourse ? (
              <CourseVideoList
                course={selectedCourse}
                queueIds={queueIds}
                onAdd={addToQueue}
              />
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Select a source
              </p>
            )}
          </div>

          {/* Right column: Queue */}
          <div className="w-96 overflow-y-auto p-3 flex flex-col">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Queue ({queue.length})
            </div>

            <div className="mb-3">
              <Input
                placeholder="Video name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Add videos from the list
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={queue.map((q) => q.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1 flex-1">
                    {queue.map((item) => (
                      <SortableQueueItem
                        key={item.id}
                        item={item}
                        onRemove={() => removeFromQueue(item.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <div className="mt-auto pt-3">
              <Button
                onClick={handleCreate}
                disabled={queue.length === 0 || !name.trim() || isCreating}
                className="w-full"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
