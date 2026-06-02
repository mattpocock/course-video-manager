import type { EffectReducer } from "use-effect-reducer";

export namespace courseViewReducer {
  export type VideoPlayerState = {
    isOpen: boolean;
    videoId: string;
    videoPath: string;
  };

  export type MoveVideoState = {
    videoId: string;
    videoPath: string;
    currentLessonId: string;
  } | null;

  export type MoveLessonState = {
    lessonId: string;
    lessonTitle: string;
    currentSectionId: string;
  } | null;

  export type RenameVideoState = {
    videoId: string;
    videoPath: string;
  } | null;

  export type State = {
    // Boolean modal toggles
    isAddCourseModalOpen: boolean;
    isCreateSectionModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isRenameCourseModalOpen: boolean;
    isPurgeExportsModalOpen: boolean;
    isRewriteCoursePathModalOpen: boolean;
    isAddStandaloneVideoModalOpen: boolean;
    isCopyTranscriptModalOpen: boolean;
    isDuplicateCourseModalOpen: boolean;
    copySectionTranscriptState: {
      sectionPath: string;
      sectionDescription: string | undefined;
      lessons: import("./course-view-types").Lesson[];
    } | null;

    // ID-based selection states (null = closed)
    addGhostLessonSectionId: string | null;
    insertAdjacentLessonId: string | null;
    insertPosition: "before" | "after" | null;
    addVideoToLessonId: string | null;
    editLessonId: string | null;
    editSectionId: string | null;
    convertToGhostLessonId: string | null;
    deleteLessonId: string | null;
    archiveSectionId: string | null;
    createOnDiskLessonId: string | null;

    // Complex object states
    videoPlayerState: VideoPlayerState;
    moveVideoState: MoveVideoState;
    moveLessonState: MoveLessonState;
    renameVideoState: RenameVideoState;

    // Filter states
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
    searchQuery: string;
  };

  export type Action =
    // Boolean modal toggles
    | { type: "set-add-course-modal-open"; open: boolean }
    | { type: "set-create-section-modal-open"; open: boolean }
    | { type: "set-version-selector-modal-open"; open: boolean }
    | { type: "set-rename-course-modal-open"; open: boolean }
    | { type: "set-purge-exports-modal-open"; open: boolean }
    | { type: "set-rewrite-course-path-modal-open"; open: boolean }
    | { type: "set-add-standalone-video-modal-open"; open: boolean }
    | { type: "set-copy-transcript-modal-open"; open: boolean }
    | { type: "set-duplicate-course-modal-open"; open: boolean }
    | {
        type: "open-copy-section-transcript";
        sectionPath: string;
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
    | { type: "set-add-video-to-lesson-id"; lessonId: string | null }
    | { type: "set-edit-lesson-id"; lessonId: string | null }
    | { type: "set-edit-section-id"; sectionId: string | null }
    | { type: "set-convert-to-ghost-lesson-id"; lessonId: string | null }
    | { type: "set-delete-lesson-id"; lessonId: string | null }
    | { type: "set-archive-section-id"; sectionId: string | null }
    | { type: "set-create-on-disk-lesson-id"; lessonId: string | null }
    // Video player
    | {
        type: "open-video-player";
        videoId: string;
        videoPath: string;
      }
    | { type: "close-video-player" }
    // Move video
    | {
        type: "open-move-video";
        videoId: string;
        videoPath: string;
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
    | { type: "open-rename-video"; videoId: string; videoPath: string }
    | { type: "close-rename-video" }
    // Filters
    | { type: "toggle-priority-filter"; priority: number }
    | { type: "toggle-icon-filter"; icon: string }
    | { type: "toggle-fs-status-filter"; status: string }
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
    isRewriteCoursePathModalOpen: false,
    isAddStandaloneVideoModalOpen: false,
    isCopyTranscriptModalOpen: false,
    isDuplicateCourseModalOpen: false,
    copySectionTranscriptState: null,
    addGhostLessonSectionId: null,
    insertAdjacentLessonId: null,
    insertPosition: null,
    addVideoToLessonId: null,
    editLessonId: null,
    editSectionId: null,
    convertToGhostLessonId: null,
    deleteLessonId: null,
    archiveSectionId: null,
    createOnDiskLessonId: null,
    videoPlayerState: { isOpen: false, videoId: "", videoPath: "" },
    moveVideoState: null,
    moveLessonState: null,
    renameVideoState: null,
    priorityFilter: [],
    iconFilter: [],
    fsStatusFilter: null,
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
      return { ...state, isCreateSectionModalOpen: action.open };
    case "set-version-selector-modal-open":
      return { ...state, isVersionSelectorModalOpen: action.open };
    case "set-rename-course-modal-open":
      return { ...state, isRenameCourseModalOpen: action.open };
    case "set-purge-exports-modal-open":
      return { ...state, isPurgeExportsModalOpen: action.open };
    case "set-rewrite-course-path-modal-open":
      return { ...state, isRewriteCoursePathModalOpen: action.open };
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
          sectionPath: action.sectionPath,
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
        addGhostLessonSectionId: action.sectionId,
        insertAdjacentLessonId: null,
        insertPosition: null,
      };
    case "set-insert-lesson":
      return {
        ...state,
        addGhostLessonSectionId: action.sectionId,
        insertAdjacentLessonId: action.adjacentLessonId,
        insertPosition: action.position,
      };
    case "set-add-video-to-lesson-id":
      return { ...state, addVideoToLessonId: action.lessonId };
    case "set-edit-lesson-id":
      return { ...state, editLessonId: action.lessonId };
    case "set-edit-section-id":
      return { ...state, editSectionId: action.sectionId };
    case "set-convert-to-ghost-lesson-id":
      return { ...state, convertToGhostLessonId: action.lessonId };
    case "set-delete-lesson-id":
      return { ...state, deleteLessonId: action.lessonId };
    case "set-archive-section-id":
      return { ...state, archiveSectionId: action.sectionId };
    case "set-create-on-disk-lesson-id":
      return { ...state, createOnDiskLessonId: action.lessonId };

    // Video player
    case "open-video-player":
      return {
        ...state,
        videoPlayerState: {
          isOpen: true,
          videoId: action.videoId,
          videoPath: action.videoPath,
        },
      };
    case "close-video-player":
      return {
        ...state,
        videoPlayerState: { isOpen: false, videoId: "", videoPath: "" },
      };

    // Move video
    case "open-move-video":
      return {
        ...state,
        moveVideoState: {
          videoId: action.videoId,
          videoPath: action.videoPath,
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
          videoPath: action.videoPath,
        },
      };
    case "close-rename-video":
      return { ...state, renameVideoState: null };

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
    case "toggle-fs-status-filter":
      return {
        ...state,
        fsStatusFilter:
          state.fsStatusFilter === action.status ? null : action.status,
      };
    case "set-search-query":
      return { ...state, searchQuery: action.query };
  }
};
