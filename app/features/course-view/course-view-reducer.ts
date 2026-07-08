import type { EffectReducer } from "use-effect-reducer";

export namespace courseViewReducer {
  export type VideoPlayerState = {
    isOpen: boolean;
    videoId: string;
    videoTitle: string;
  };

  export type MoveVideoState = {
    videoId: string;
    videoTitle: string;
    currentLessonId: string;
  } | null;

  export type MoveLessonState = {
    lessonId: string;
    lessonTitle: string;
    currentSectionId: string;
  } | null;

  export type RenameVideoState = {
    videoId: string;
    videoTitle: string;
  } | null;

  export type CopyVideoState = {
    videoId: string;
    videoTitle: string;
    clipCount: number;
    beatCount: number;
  } | null;

  export type LessonSelection = {
    sectionId: string;
    lessonIds: Set<string>;
  } | null;

  export type State = {
    // Boolean modal toggles
    isAddCourseModalOpen: boolean;
    isCreateSectionModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isRenameCourseModalOpen: boolean;
    isPurgeExportsModalOpen: boolean;
    isAddStandaloneVideoModalOpen: boolean;
    isCopyTranscriptModalOpen: boolean;
    isDuplicateCourseModalOpen: boolean;
    copySectionTranscriptState: {
      sectionTitle: string;
      sectionDescription: string | undefined;
      lessons: import("./course-view-types").Lesson[];
    } | null;

    // ID-based selection states (null = closed)
    addLessonSectionId: string | null;
    insertAdjacentLessonId: string | null;
    insertPosition: "before" | "after" | null;
    insertAdjacentSectionId: string | null;
    insertSectionPosition: "before" | "after" | null;
    addVideoToLessonId: string | null;
    editLessonId: string | null;
    editSectionId: string | null;
    deleteLessonId: string | null;
    archiveSectionId: string | null;
    editDescriptionLessonId: string | null;

    // Complex object states
    videoPlayerState: VideoPlayerState;
    moveVideoState: MoveVideoState;
    moveLessonState: MoveLessonState;
    renameVideoState: RenameVideoState;
    copyVideoState: CopyVideoState;

    // Lesson selection
    lessonSelection: LessonSelection;

    // Filter states
    priorityFilter: number[];
    iconFilter: string[];
    todoFilter: boolean;
    searchQuery: string;
  };

  export type Action =
    // Boolean modal toggles
    | { type: "set-add-course-modal-open"; open: boolean }
    | { type: "set-create-section-modal-open"; open: boolean }
    | { type: "set-version-selector-modal-open"; open: boolean }
    | { type: "set-rename-course-modal-open"; open: boolean }
    | { type: "set-purge-exports-modal-open"; open: boolean }
    | { type: "set-add-standalone-video-modal-open"; open: boolean }
    | { type: "set-copy-transcript-modal-open"; open: boolean }
    | { type: "set-duplicate-course-modal-open"; open: boolean }
    | {
        type: "open-copy-section-transcript";
        sectionTitle: string;
        sectionDescription?: string;
        lessons: import("./course-view-types").Lesson[];
      }
    | { type: "close-copy-section-transcript" }
    // ID-based selections
    | { type: "set-add-lesson-section-id"; sectionId: string | null }
    | {
        type: "set-insert-lesson";
        sectionId: string;
        adjacentLessonId: string;
        position: "before" | "after";
      }
    | {
        type: "set-insert-section";
        adjacentSectionId: string;
        position: "before" | "after";
      }
    | { type: "set-add-video-to-lesson-id"; lessonId: string | null }
    | { type: "set-edit-lesson-id"; lessonId: string | null }
    | { type: "set-edit-section-id"; sectionId: string | null }
    | { type: "set-delete-lesson-id"; lessonId: string | null }
    | { type: "set-archive-section-id"; sectionId: string | null }
    | { type: "set-edit-description-lesson-id"; lessonId: string | null }
    // Video player
    | {
        type: "open-video-player";
        videoId: string;
        videoTitle: string;
      }
    | { type: "close-video-player" }
    // Move video
    | {
        type: "open-move-video";
        videoId: string;
        videoTitle: string;
        currentLessonId: string;
      }
    | { type: "close-move-video" }
    | {
        type: "video-moved";
        videoId: string;
        fromLessonId: string;
        toLessonId: string;
      }
    // Move lesson
    | {
        type: "open-move-lesson";
        lessonId: string;
        lessonTitle: string;
        currentSectionId: string;
      }
    | { type: "close-move-lesson" }
    // Rename video
    | { type: "open-rename-video"; videoId: string; videoTitle: string }
    | { type: "close-rename-video" }
    // Copy video
    | {
        type: "open-copy-video";
        videoId: string;
        videoTitle: string;
        clipCount: number;
        beatCount: number;
      }
    | { type: "close-copy-video" }
    // Lesson selection
    | {
        type: "select-lesson-only";
        lessonId: string;
        sectionId: string;
      }
    | {
        type: "toggle-lesson-selection";
        lessonId: string;
        sectionId: string;
      }
    | { type: "clear-lesson-selection" }
    | { type: "prune-lesson-selection"; currentLessonIds: string[] }
    // Filters
    | { type: "toggle-priority-filter"; priority: number }
    | { type: "toggle-icon-filter"; icon: string }
    | { type: "toggle-todo-filter" }
    | { type: "set-search-query"; query: string };

  export type Effect = never;
}

export function createInitialCourseViewState(): courseViewReducer.State {
  return {
    isAddCourseModalOpen: false,
    isCreateSectionModalOpen: false,
    isVersionSelectorModalOpen: false,
    isRenameCourseModalOpen: false,
    isPurgeExportsModalOpen: false,
    isAddStandaloneVideoModalOpen: false,
    isCopyTranscriptModalOpen: false,
    isDuplicateCourseModalOpen: false,
    copySectionTranscriptState: null,
    addLessonSectionId: null,
    insertAdjacentLessonId: null,
    insertPosition: null,
    insertAdjacentSectionId: null,
    insertSectionPosition: null,
    addVideoToLessonId: null,
    editLessonId: null,
    editSectionId: null,
    deleteLessonId: null,
    archiveSectionId: null,
    editDescriptionLessonId: null,
    videoPlayerState: { isOpen: false, videoId: "", videoTitle: "" },
    moveVideoState: null,
    moveLessonState: null,
    renameVideoState: null,
    copyVideoState: null,
    lessonSelection: null,
    priorityFilter: [],
    iconFilter: [],
    todoFilter: false,
    searchQuery: "",
  };
}

export const courseViewReducer: EffectReducer<
  courseViewReducer.State,
  courseViewReducer.Action,
  courseViewReducer.Effect
> = (state, action) => {
  switch (action.type) {
    // Boolean modal toggles
    case "set-add-course-modal-open":
      return { ...state, isAddCourseModalOpen: action.open };
    case "set-create-section-modal-open":
      return {
        ...state,
        isCreateSectionModalOpen: action.open,
        insertAdjacentSectionId: null,
        insertSectionPosition: null,
      };
    case "set-version-selector-modal-open":
      return { ...state, isVersionSelectorModalOpen: action.open };
    case "set-rename-course-modal-open":
      return { ...state, isRenameCourseModalOpen: action.open };
    case "set-purge-exports-modal-open":
      return { ...state, isPurgeExportsModalOpen: action.open };
    case "set-add-standalone-video-modal-open":
      return { ...state, isAddStandaloneVideoModalOpen: action.open };
    case "set-copy-transcript-modal-open":
      return { ...state, isCopyTranscriptModalOpen: action.open };
    case "set-duplicate-course-modal-open":
      return { ...state, isDuplicateCourseModalOpen: action.open };
    case "open-copy-section-transcript":
      return {
        ...state,
        copySectionTranscriptState: {
          sectionTitle: action.sectionTitle,
          sectionDescription: action.sectionDescription,
          lessons: action.lessons,
        },
      };
    case "close-copy-section-transcript":
      return { ...state, copySectionTranscriptState: null };

    // ID-based selections
    case "set-add-lesson-section-id":
      return {
        ...state,
        addLessonSectionId: action.sectionId,
        insertAdjacentLessonId: null,
        insertPosition: null,
      };
    case "set-insert-lesson":
      return {
        ...state,
        addLessonSectionId: action.sectionId,
        insertAdjacentLessonId: action.adjacentLessonId,
        insertPosition: action.position,
      };
    case "set-insert-section":
      return {
        ...state,
        isCreateSectionModalOpen: true,
        insertAdjacentSectionId: action.adjacentSectionId,
        insertSectionPosition: action.position,
      };
    case "set-add-video-to-lesson-id":
      return { ...state, addVideoToLessonId: action.lessonId };
    case "set-edit-lesson-id":
      return { ...state, editLessonId: action.lessonId };
    case "set-edit-section-id":
      return { ...state, editSectionId: action.sectionId };
    case "set-delete-lesson-id":
      return { ...state, deleteLessonId: action.lessonId };
    case "set-archive-section-id":
      return { ...state, archiveSectionId: action.sectionId };
    case "set-edit-description-lesson-id":
      return { ...state, editDescriptionLessonId: action.lessonId };

    // Video player
    case "open-video-player":
      return {
        ...state,
        videoPlayerState: {
          isOpen: true,
          videoId: action.videoId,
          videoTitle: action.videoTitle,
        },
      };
    case "close-video-player":
      return {
        ...state,
        videoPlayerState: { isOpen: false, videoId: "", videoTitle: "" },
      };

    // Move video
    case "open-move-video":
      return {
        ...state,
        moveVideoState: {
          videoId: action.videoId,
          videoTitle: action.videoTitle,
          currentLessonId: action.currentLessonId,
        },
      };
    case "close-move-video":
      return { ...state, moveVideoState: null };
    case "video-moved":
      return state;

    // Move lesson
    case "open-move-lesson":
      return {
        ...state,
        moveLessonState: {
          lessonId: action.lessonId,
          lessonTitle: action.lessonTitle,
          currentSectionId: action.currentSectionId,
        },
      };
    case "close-move-lesson":
      return { ...state, moveLessonState: null };

    // Rename video
    case "open-rename-video":
      return {
        ...state,
        renameVideoState: {
          videoId: action.videoId,
          videoTitle: action.videoTitle,
        },
      };
    case "close-rename-video":
      return { ...state, renameVideoState: null };

    // Copy video
    case "open-copy-video":
      return {
        ...state,
        copyVideoState: {
          videoId: action.videoId,
          videoTitle: action.videoTitle,
          clipCount: action.clipCount,
          beatCount: action.beatCount,
        },
      };
    case "close-copy-video":
      return { ...state, copyVideoState: null };

    // Lesson selection
    case "select-lesson-only":
      return {
        ...state,
        lessonSelection: {
          sectionId: action.sectionId,
          lessonIds: new Set([action.lessonId]),
        },
      };
    case "toggle-lesson-selection": {
      if (
        !state.lessonSelection ||
        state.lessonSelection.sectionId !== action.sectionId
      ) {
        return {
          ...state,
          lessonSelection: {
            sectionId: action.sectionId,
            lessonIds: new Set([action.lessonId]),
          },
        };
      }
      const next = new Set(state.lessonSelection.lessonIds);
      if (next.has(action.lessonId)) {
        next.delete(action.lessonId);
      } else {
        next.add(action.lessonId);
      }
      return {
        ...state,
        lessonSelection:
          next.size === 0
            ? null
            : { sectionId: action.sectionId, lessonIds: next },
      };
    }
    case "clear-lesson-selection":
      return { ...state, lessonSelection: null };
    case "prune-lesson-selection": {
      if (!state.lessonSelection) return state;
      const allowed = new Set(action.currentLessonIds);
      const pruned = new Set(
        [...state.lessonSelection.lessonIds].filter((id) => allowed.has(id))
      );
      if (pruned.size === state.lessonSelection.lessonIds.size) return state;
      if (pruned.size === 0) return { ...state, lessonSelection: null };
      return {
        ...state,
        lessonSelection: {
          sectionId: state.lessonSelection.sectionId,
          lessonIds: pruned,
        },
      };
    }

    // Filters
    case "toggle-priority-filter":
      return {
        ...state,
        priorityFilter: state.priorityFilter.includes(action.priority)
          ? state.priorityFilter.filter((p) => p !== action.priority)
          : [...state.priorityFilter, action.priority],
      };
    case "toggle-icon-filter":
      return {
        ...state,
        iconFilter: state.iconFilter.includes(action.icon)
          ? state.iconFilter.filter((i) => i !== action.icon)
          : [...state.iconFilter, action.icon],
      };
    case "toggle-todo-filter":
      return { ...state, todoFilter: !state.todoFilter };
    case "set-search-query":
      return { ...state, searchQuery: action.query };
  }
};
