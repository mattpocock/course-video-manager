import { type DependencyLessonItem } from "@/components/dependency-selector";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { SortableLessonItem } from "./sortable-lesson-item";
import type { LoaderData, Section, Lesson } from "./course-view-types";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { X } from "lucide-react";
import { useNavigate, useFetcher } from "react-router";

function isTodoLesson(lesson: Lesson): boolean {
  return lesson.authoringStatus === "todo";
}

export function NextTodoCard({
  sections,
  data,
  navigate,
  addVideoToLessonId,
  deleteLessonId,
  editDescriptionLessonId,
  dispatch,
  submitEvent,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
  allFlatLessons,
  dependencyMap,
  dismissed,
  onDismiss,
}: {
  sections: Section[];
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  addVideoToLessonId: string | null;
  deleteLessonId: string | null;
  editDescriptionLessonId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
  allFlatLessons: DependencyLessonItem[];
  dependencyMap: Record<string, string[]>;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  // Find highest priority todo lesson across all sections
  let bestLesson: Lesson | null = null;
  let bestSection: Section | null = null;
  let bestPriority = Infinity;

  for (const section of sections) {
    for (const lesson of section.lessons) {
      if (!isTodoLesson(lesson)) continue;
      const priority = lesson.priority ?? 2;
      if (priority < bestPriority) {
        bestPriority = priority;
        bestLesson = lesson;
        bestSection = section;
      }
    }
  }

  if (!bestLesson || !bestSection || dismissed) return null;

  return (
    <div className="lg:w-[calc(50%-0.75rem)]">
      <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
        Next Up
      </h3>
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h2 className="font-medium text-sm">{bestSection.path}</h2>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-2">
          <DndContext>
            <SortableContext
              items={[bestLesson.id]}
              strategy={verticalListSortingStrategy}
            >
              <SortableLessonItem
                lesson={bestLesson}
                lessonIndex={0}
                section={bestSection}
                data={data}
                navigate={navigate}
                addVideoToLessonId={addVideoToLessonId}
                deleteLessonId={deleteLessonId}
                editDescriptionLessonId={editDescriptionLessonId}
                dispatch={dispatch}
                submitEvent={submitEvent}
                startExportUpload={startExportUpload}
                revealVideoFetcher={revealVideoFetcher}
                deleteVideoFileFetcher={deleteVideoFileFetcher}
                submitDeleteVideo={submitDeleteVideo}
                allFlatLessons={allFlatLessons}
                allSections={sections}
                dependencyMap={dependencyMap}
                hideAnchor
              />
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
