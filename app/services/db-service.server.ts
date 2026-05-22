import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { Effect } from "effect";

export class DBFunctionsService extends Effect.Service<DBFunctionsService>()(
  "DBFunctionsService",
  {
    effect: Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const courseOps = yield* CourseOperationsService;
      const videoOps = yield* VideoOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const linkAuthOps = yield* LinkAuthOperationsService;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const pitchOps = yield* PitchOperationsService;
      const deliverableOps = yield* DeliverableOperationsService;

      return {
        getClipById: clipOps.getClipById,
        getClipsByIds: clipOps.getClipsByIds,
        updateClip: clipOps.updateClip,
        archiveClip: clipOps.archiveClip,
        reorderClip: clipOps.reorderClip,
        createChapter: clipOps.createChapter,
        createChapterAtInsertionPoint: clipOps.createChapterAtInsertionPoint,
        createChapterAtPosition: clipOps.createChapterAtPosition,
        getChapterById: clipOps.getChapterById,
        updateChapter: clipOps.updateChapter,
        archiveChapter: clipOps.archiveChapter,
        reorderChapter: clipOps.reorderChapter,
        appendClips: clipOps.appendClips,

        getCourseById: courseOps.getCourseById,
        getCourseByFilePath: courseOps.getCourseByFilePath,
        getCourseWithSectionsById: courseOps.getCourseWithSectionsById,
        getCourseStructureById: courseOps.getCourseStructureById,
        getCourseWithSlimClipsById: courseOps.getCourseWithSlimClipsById,
        getVideoTranscripts: courseOps.getVideoTranscripts,
        getCourseWithSectionsByFilePath:
          courseOps.getCourseWithSectionsByFilePath,
        getCourses: courseOps.getCourses,
        getTopActiveCourses: courseOps.getTopActiveCourses,
        getArchivedCourses: courseOps.getArchivedCourses,
        createCourse: courseOps.createCourse,
        createGhostCourse: courseOps.createGhostCourse,
        updateCourseName: courseOps.updateCourseName,
        updateCourseMemory: courseOps.updateCourseMemory,
        updateCourseArchiveStatus: courseOps.updateCourseArchiveStatus,
        updateCourseFilePath: courseOps.updateCourseFilePath,
        deleteCourse: courseOps.deleteCourse,
        duplicateCourse: courseOps.duplicateCourse,

        getReferenceVideoCandidates: videoOps.getReferenceVideoCandidates,
        getVideoById: videoOps.getVideoDeepById,
        getVideoWithClipsById: videoOps.getVideoWithClipsById,
        getVideoWithLessonById: videoOps.getVideoWithLessonById,
        getStandaloneVideos: videoOps.getStandaloneVideos,
        getStandaloneVideosSidebar: videoOps.getStandaloneVideosSidebar,
        getAllStandaloneVideos: videoOps.getAllStandaloneVideos,
        getArchivedStandaloneVideos: videoOps.getArchivedStandaloneVideos,
        createVideo: videoOps.createVideo,
        createStandaloneVideo: videoOps.createStandaloneVideo,
        hasOriginalFootagePathAlreadyBeenUsed:
          videoOps.hasOriginalFootagePathAlreadyBeenUsed,
        updateVideo: videoOps.updateVideo,
        deleteVideo: videoOps.deleteVideo,
        updateVideoPath: videoOps.updateVideoPath,
        updateVideoLesson: videoOps.updateVideoLesson,
        updateVideoArchiveStatus: videoOps.updateVideoArchiveStatus,
        getNextVideoId: videoOps.getNextVideoId,
        getPreviousVideoId: videoOps.getPreviousVideoId,
        getNextLessonWithoutVideo: videoOps.getNextLessonWithoutVideo,
        getVideosForFewShotExamples: videoOps.getVideosForFewShotExamples,

        getCourseVersions: versionOps.getCourseVersions,
        getLatestCourseVersion: versionOps.getLatestCourseVersion,
        getCourseVersionById: versionOps.getCourseVersionById,
        getCourseWithSectionsByVersion:
          versionOps.getCourseWithSectionsByVersion,
        getCourseWithSectionsByVersionSlim:
          versionOps.getCourseWithSectionsByVersionSlim,
        getVersionWithSections: versionOps.getVersionWithSections,
        createCourseVersion: versionOps.createCourseVersion,
        updateCourseVersion: versionOps.updateCourseVersion,
        copyVersionStructure: versionOps.copyVersionStructure,
        getVideoIdsForVersion: versionOps.getVideoIdsForVersion,
        getAllVersionsWithStructure: versionOps.getAllVersionsWithStructure,

        getLessonById: lessonSectionOps.getLessonById,
        getLessonsBySectionId: lessonSectionOps.getLessonsBySectionId,
        getLessonWithHierarchyById: lessonSectionOps.getLessonWithHierarchyById,
        getSectionWithHierarchyById:
          lessonSectionOps.getSectionWithHierarchyById,
        createSections: lessonSectionOps.createSections,
        createLessons: lessonSectionOps.createLessons,
        createGhostLesson: lessonSectionOps.createGhostLesson,
        updateLesson: lessonSectionOps.updateLesson,
        deleteLesson: lessonSectionOps.deleteLesson,
        deleteSection: lessonSectionOps.deleteSection,
        archiveSection: lessonSectionOps.archiveSection,
        updateSectionOrder: lessonSectionOps.updateSectionOrder,
        updateSectionPath: lessonSectionOps.updateSectionPath,
        updateSectionDescription: lessonSectionOps.updateSectionDescription,
        getSectionsByIds: lessonSectionOps.getSectionsByIds,
        getSectionsByRepoVersionId: lessonSectionOps.getSectionsByRepoVersionId,
        updateLessonOrder: lessonSectionOps.updateLessonOrder,
        batchUpdateLessonOrders: lessonSectionOps.batchUpdateLessonOrders,
        batchUpdateSectionOrders: lessonSectionOps.batchUpdateSectionOrders,

        getLinks: linkAuthOps.getLinks,
        createLink: linkAuthOps.createLink,
        deleteLink: linkAuthOps.deleteLink,
        getYoutubeAuth: linkAuthOps.getYoutubeAuth,
        upsertYoutubeAuth: linkAuthOps.upsertYoutubeAuth,
        updateYoutubeAccessToken: linkAuthOps.updateYoutubeAccessToken,
        deleteYoutubeAuth: linkAuthOps.deleteYoutubeAuth,
        getAiHeroAuth: linkAuthOps.getAiHeroAuth,
        upsertAiHeroAuth: linkAuthOps.upsertAiHeroAuth,
        deleteAiHeroAuth: linkAuthOps.deleteAiHeroAuth,

        getThumbnailsByVideoId: thumbnailOps.getThumbnailsByVideoId,
        createThumbnail: thumbnailOps.createThumbnail,
        getThumbnailById: thumbnailOps.getThumbnailById,
        updateThumbnail: thumbnailOps.updateThumbnail,
        deleteThumbnail: thumbnailOps.deleteThumbnail,

        createPitch: pitchOps.createPitch,
        listPitches: pitchOps.listPitches,
        listPitchesWithVideos: pitchOps.listPitchesWithVideos,
        getPitch: pitchOps.getPitch,
        getPitchWithVideos: pitchOps.getPitchWithVideos,
        updatePitchField: pitchOps.updatePitchField,
        createVideoFromPitch: pitchOps.createVideoFromPitch,
        deletePitch: pitchOps.deletePitch,

        listDeliverables: deliverableOps.listDeliverables,
        createDeliverable: deliverableOps.createDeliverable,
        updateDeliverableStatus: deliverableOps.updateDeliverableStatus,
        updateDeliverable: deliverableOps.updateDeliverable,
        duplicateDeliverable: deliverableOps.duplicateDeliverable,
        archiveDeliverable: deliverableOps.archiveDeliverable,
      };
    }),
    dependencies: [
      ClipOperationsService.Default,
      CourseOperationsService.Default,
      VideoOperationsService.Default,
      VersionOperationsService.Default,
      LessonSectionOperationsService.Default,
      LinkAuthOperationsService.Default,
      ThumbnailOperationsService.Default,
      PitchOperationsService.Default,
      DeliverableOperationsService.Default,
    ],
  }
) {}
