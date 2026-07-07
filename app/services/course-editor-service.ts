/**
 * CourseEditorService
 *
 * Single RPC-style service for all course editor mutations, following the
 * ClipService pattern. Discriminated union events, transport abstraction,
 * HTTP transport for production, direct transport for tests.
 *
 * Covers 4 section events + 13 lesson events + beat events.
 */

import type { BeatKind } from "@/features/beats/beat-kinds";

// ============================================================================
// Event Types
// ============================================================================

export type CourseEditorEvent =
  // --- Section events ---
  | {
      type: "create-section";
      repoVersionId: string;
      title: string;
      maxOrder: number;
      adjacentSectionId?: string;
      position?: "before" | "after";
    }
  | {
      type: "update-section-name";
      sectionId: string;
      title: string;
    }
  | {
      type: "update-section-description";
      sectionId: string;
      description: string;
    }
  | {
      type: "archive-section";
      sectionId: string;
    }
  | {
      type: "reorder-sections";
      sectionIds: string[];
    }
  // --- Lesson events ---
  | {
      type: "add-ghost-lesson";
      sectionId: string;
      title: string;
      adjacentLessonId?: string;
      position?: "before" | "after";
    }
  | {
      type: "create-real-lesson";
      sectionId: string;
      title: string;
      adjacentLessonId?: string;
      position?: "before" | "after";
    }
  | {
      type: "update-lesson-name";
      lessonId: string;
      newSlug: string;
    }
  | {
      type: "update-lesson-title";
      lessonId: string;
      title: string;
    }
  | {
      type: "update-lesson-description";
      lessonId: string;
      description: string;
    }
  | {
      type: "update-lesson-icon";
      lessonId: string;
      icon: "watch" | "code" | "discussion";
    }
  | {
      type: "update-lesson-priority";
      lessonId: string;
      priority: 1 | 2 | 3;
    }
  | {
      type: "update-lesson-dependencies";
      lessonId: string;
      dependencies: string[];
    }
  | {
      type: "delete-lesson";
      lessonId: string;
    }
  | {
      type: "reorder-lessons";
      sectionId: string;
      lessonIds: string[];
    }
  | {
      type: "move-lesson-to-section";
      lessonId: string;
      targetSectionId: string;
      /**
       * Drop anchor: place the moved lesson immediately before this lesson in
       * the target section. `null`/absent appends to the end of the target.
       */
      beforeLessonId?: string | null;
    }
  | {
      type: "move-lessons-to-section";
      lessonIds: string[];
      targetSectionId: string;
      /**
       * Drop anchor: place the moved block immediately before this lesson in
       * the target section. `null`/absent appends to the end of the target.
       * Never one of `lessonIds`.
       */
      beforeLessonId?: string | null;
    }
  | {
      type: "convert-to-ghost";
      lessonId: string;
    }
  | {
      type: "create-on-disk";
      lessonId: string;
      repoPath?: string;
    }
  | {
      type: "set-lesson-authoring-status";
      lessonId: string;
      status: "todo" | "done";
    }
  // --- Beat events ---
  | {
      type: "create-beat";
      videoId: string;
      kind: BeatKind;
      /** Initial title for the new Beat. Absent/empty leaves it untitled. */
      title?: string;
      /**
       * Insertion anchor: place the new Beat immediately before this one in
       * the Video's plan. `null`/absent appends to the end.
       */
      beforeBeatId?: string | null;
    }
  | {
      type: "rename-beat";
      beatId: string;
      title: string;
    }
  | {
      type: "update-beat-description";
      beatId: string;
      description: string;
    }
  | {
      type: "set-beat-kind";
      beatId: string;
      kind: BeatKind;
    }
  | {
      type: "delete-beat";
      beatId: string;
    }
  | {
      type: "move-beat";
      beatId: string;
      targetVideoId: string;
      /**
       * Drop anchor: place the moved Beat immediately before this one in the
       * target Video. `null`/absent appends to the target's end.
       */
      beforeBeatId?: string | null;
    };

// ============================================================================
// Transport Type
// ============================================================================

export type CourseEditorTransport = (
  event: CourseEditorEvent
) => Promise<unknown>;

// ============================================================================
// Service Interface
// ============================================================================

export interface CourseEditorService {
  // Section operations
  createSection(
    repoVersionId: string,
    title: string,
    maxOrder: number,
    opts?: { adjacentSectionId: string; position: "before" | "after" }
  ): Promise<{ success: true; sectionId: string }>;

  updateSectionName(sectionId: string, title: string): Promise<unknown>;

  updateSectionDescription(
    sectionId: string,
    description: string
  ): Promise<{ success: true }>;

  archiveSection(sectionId: string): Promise<{ success: true }>;

  reorderSections(sectionIds: string[]): Promise<{ success: true }>;

  // Lesson operations
  addGhostLesson(
    sectionId: string,
    title: string,
    opts?: { adjacentLessonId?: string; position?: "before" | "after" }
  ): Promise<{ success: true; lessonId: string }>;

  createRealLesson(
    sectionId: string,
    title: string,
    opts?: { adjacentLessonId?: string; position?: "before" | "after" }
  ): Promise<{ success: true; lessonId: string; path: string }>;

  updateLessonName(
    lessonId: string,
    newSlug: string
  ): Promise<{ success: true; path: string }>;

  updateLessonTitle(
    lessonId: string,
    title: string
  ): Promise<{ success: true }>;

  updateLessonDescription(
    lessonId: string,
    description: string
  ): Promise<{ success: true }>;

  updateLessonIcon(
    lessonId: string,
    icon: "watch" | "code" | "discussion"
  ): Promise<{ success: true }>;

  updateLessonPriority(
    lessonId: string,
    priority: 1 | 2 | 3
  ): Promise<{ success: true }>;

  updateLessonDependencies(
    lessonId: string,
    dependencies: string[]
  ): Promise<{ success: true }>;

  deleteLesson(lessonId: string): Promise<{ success: true }>;

  reorderLessons(
    sectionId: string,
    lessonIds: string[]
  ): Promise<{ success: true }>;

  moveLessonToSection(
    lessonId: string,
    targetSectionId: string,
    beforeLessonId?: string | null
  ): Promise<{ success: true }>;

  moveLessonsToSection(
    lessonIds: string[],
    targetSectionId: string,
    beforeLessonId?: string | null
  ): Promise<{ success: true }>;

  convertToGhost(lessonId: string): Promise<{ success: true }>;

  createOnDisk(
    lessonId: string,
    opts?: { repoPath?: string }
  ): Promise<{
    success: true;
    path: string;
    sectionId?: string;
    sectionPath?: string;
    courseFilePath?: string;
  }>;

  setLessonAuthoringStatus(
    lessonId: string,
    status: "todo" | "done"
  ): Promise<{ success: true }>;

  // Beat operations
  createBeat(
    videoId: string,
    kind: BeatKind,
    title?: string,
    beforeBeatId?: string | null
  ): Promise<{ success: true; beatId: string }>;

  renameBeat(beatId: string, title: string): Promise<{ success: true }>;

  setBeatDescription(
    beatId: string,
    description: string
  ): Promise<{ success: true }>;

  setBeatKind(beatId: string, kind: BeatKind): Promise<{ success: true }>;

  deleteBeat(beatId: string): Promise<{ success: true }>;

  moveBeat(
    beatId: string,
    targetVideoId: string,
    beforeBeatId?: string | null
  ): Promise<{ success: true }>;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCourseEditorService(
  send: CourseEditorTransport
): CourseEditorService {
  return {
    // --- Section operations ---
    async createSection(repoVersionId, title, maxOrder, opts) {
      return send({
        type: "create-section",
        repoVersionId,
        title,
        maxOrder,
        ...opts,
      }) as Promise<{ success: true; sectionId: string }>;
    },

    async updateSectionName(sectionId, title) {
      return send({
        type: "update-section-name",
        sectionId,
        title,
      });
    },

    async updateSectionDescription(sectionId, description) {
      return send({
        type: "update-section-description",
        sectionId,
        description,
      }) as Promise<{ success: true }>;
    },

    async archiveSection(sectionId) {
      return send({
        type: "archive-section",
        sectionId,
      }) as Promise<{ success: true }>;
    },

    async reorderSections(sectionIds) {
      return send({
        type: "reorder-sections",
        sectionIds,
      }) as Promise<{ success: true }>;
    },

    // --- Lesson operations ---
    async addGhostLesson(sectionId, title, opts) {
      return send({
        type: "add-ghost-lesson",
        sectionId,
        title,
        ...(opts?.adjacentLessonId && {
          adjacentLessonId: opts.adjacentLessonId,
        }),
        ...(opts?.position && { position: opts.position }),
      }) as Promise<{ success: true; lessonId: string }>;
    },

    async createRealLesson(sectionId, title, opts) {
      return send({
        type: "create-real-lesson",
        sectionId,
        title,
        ...(opts?.adjacentLessonId && {
          adjacentLessonId: opts.adjacentLessonId,
        }),
        ...(opts?.position && { position: opts.position }),
      }) as Promise<{ success: true; lessonId: string; path: string }>;
    },

    async updateLessonName(lessonId, newSlug) {
      return send({
        type: "update-lesson-name",
        lessonId,
        newSlug,
      }) as Promise<{ success: true; path: string }>;
    },

    async updateLessonTitle(lessonId, title) {
      return send({
        type: "update-lesson-title",
        lessonId,
        title,
      }) as Promise<{ success: true }>;
    },

    async updateLessonDescription(lessonId, description) {
      return send({
        type: "update-lesson-description",
        lessonId,
        description,
      }) as Promise<{ success: true }>;
    },

    async updateLessonIcon(lessonId, icon) {
      return send({
        type: "update-lesson-icon",
        lessonId,
        icon,
      }) as Promise<{ success: true }>;
    },

    async updateLessonPriority(lessonId, priority) {
      return send({
        type: "update-lesson-priority",
        lessonId,
        priority,
      }) as Promise<{ success: true }>;
    },

    async updateLessonDependencies(lessonId, dependencies) {
      return send({
        type: "update-lesson-dependencies",
        lessonId,
        dependencies,
      }) as Promise<{ success: true }>;
    },

    async deleteLesson(lessonId) {
      return send({
        type: "delete-lesson",
        lessonId,
      }) as Promise<{ success: true }>;
    },

    async reorderLessons(sectionId, lessonIds) {
      return send({
        type: "reorder-lessons",
        sectionId,
        lessonIds,
      }) as Promise<{ success: true }>;
    },

    async moveLessonToSection(
      lessonId,
      targetSectionId,
      beforeLessonId = null
    ) {
      return send({
        type: "move-lesson-to-section",
        lessonId,
        targetSectionId,
        beforeLessonId,
      }) as Promise<{ success: true }>;
    },

    async moveLessonsToSection(
      lessonIds,
      targetSectionId,
      beforeLessonId = null
    ) {
      return send({
        type: "move-lessons-to-section",
        lessonIds,
        targetSectionId,
        beforeLessonId,
      }) as Promise<{ success: true }>;
    },

    async convertToGhost(lessonId) {
      return send({
        type: "convert-to-ghost",
        lessonId,
      }) as Promise<{ success: true }>;
    },

    async createOnDisk(lessonId, opts) {
      return send({
        type: "create-on-disk",
        lessonId,
        ...(opts?.repoPath && { repoPath: opts.repoPath }),
      }) as Promise<{
        success: true;
        path: string;
        sectionId?: string;
        sectionPath?: string;
        courseFilePath?: string;
      }>;
    },

    async setLessonAuthoringStatus(lessonId, status) {
      return send({
        type: "set-lesson-authoring-status",
        lessonId,
        status,
      }) as Promise<{ success: true }>;
    },

    // --- Beat operations ---
    async createBeat(videoId, kind, title = "", beforeBeatId = null) {
      return send({
        type: "create-beat",
        videoId,
        kind,
        title,
        beforeBeatId,
      }) as Promise<{ success: true; beatId: string }>;
    },

    async renameBeat(beatId, title) {
      return send({
        type: "rename-beat",
        beatId,
        title,
      }) as Promise<{ success: true }>;
    },

    async setBeatDescription(beatId, description) {
      return send({
        type: "update-beat-description",
        beatId,
        description,
      }) as Promise<{ success: true }>;
    },

    async setBeatKind(beatId, kind) {
      return send({
        type: "set-beat-kind",
        beatId,
        kind,
      }) as Promise<{ success: true }>;
    },

    async deleteBeat(beatId) {
      return send({
        type: "delete-beat",
        beatId,
      }) as Promise<{ success: true }>;
    },

    async moveBeat(beatId, targetVideoId, beforeBeatId = null) {
      return send({
        type: "move-beat",
        beatId,
        targetVideoId,
        beforeBeatId,
      }) as Promise<{ success: true }>;
    },
  };
}
