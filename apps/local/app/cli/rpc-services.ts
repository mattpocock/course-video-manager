/**
 * The service tags command handlers may request.
 *
 * These tags expose only the RPC mappings in ./rpc-layer.ts. Importing a
 * database service tag here would let a command compile against a method with
 * no HTTP endpoint.
 */
export {
  CvmBeatOperationsService as BeatOperationsService,
  CvmClipOperationsService as ClipOperationsService,
  CvmCourseOperationsService as CourseOperationsService,
  CvmCourseWriteService as CourseWriteService,
  CvmDeliverableOperationsService as DeliverableOperationsService,
  CvmLearningGoalOperationsService as LearningGoalOperationsService,
  CvmLessonSectionOperationsService as LessonSectionOperationsService,
  CvmOverlayOperationsService as OverlayOperationsService,
  CvmPitchOperationsService as PitchOperationsService,
  CvmSearchOperationsService as SearchOperationsService,
  CvmVersionOperationsService as VersionOperationsService,
  CvmVideoOperationsService as VideoOperationsService,
} from "./rpc-layer";
