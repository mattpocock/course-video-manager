import { Context, Layer } from "effect";
import type { BeatOperationsService } from "@/services/db-beat-operations.server";
import type { ClipOperationsService } from "@/services/db-clip-operations.server";
import type { CourseOperationsService } from "@/services/db-course-operations.server";
import type { CourseWriteService } from "@/services/course-write-service";
import type { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import type { LearningGoalOperationsService } from "@/services/db-learning-goal-operations.server";
import type { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import type { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import type { PitchOperationsService } from "@/services/db-pitch-operations.server";
import type { SearchOperationsService } from "@/services/db-search-operations.server";
import type { VersionOperationsService } from "@/services/db-version-operations.server";
import type { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  callRpc,
  makeRpcClient,
  rpcMethod,
  type RemoteService,
  type RpcClient,
  type RpcClientConfig,
} from "./rpc-client";

/**
 * The CLI's transport layer: the domain services, backed by HTTP instead of a
 * Postgres connection.
 *
 * Each adapter has a CLI-specific TAG whose service type is inferred from its
 * mapped methods. Commands can ask only for methods with HTTP endpoints, so a
 * new command cannot compile against an unmapped domain method.
 *
 * THERE IS ONE TRANSPORT. The author's own `cvm` goes through here too. A
 * second in-process path for local use would be the path least exercised, on
 * the machine least watched.
 *
 * HOW A METHOD IS ADDED, and what stops it going wrong. One `.post` in the
 * matching `apps/remote/routes/*` file, one line here — and three separate
 * things check that line:
 *
 *   the ENDPOINT   `hc<RemoteApp>` is built from the deployed app's route
 *                  table, so a renamed or missing route is a compile error
 *                  rather than a 404 on a box nobody is watching;
 *   the SIGNATURE  `CvmRemoteAdapter` checks every mapped method against the
 *                  service's own declaration in `@cvm/core`;
 *   the ARGUMENTS  `rpcMethod` forwards them variadically, so there is nowhere
 *                  for a hand-written call to reorder or drop one.
 *
 * The CLI tags are deliberately distinct from the database service tags.
 * Their methods include the wire failures an HTTP call can add, while the
 * database services remain available to the local-only publish graph.
 */

/**
 * The mapped methods one domain service exposes through `cvm`.
 *
 * `Partial` makes a route optional, while `RemoteService` contextualizes each
 * mapped key with its domain method signature. The inferred object type keeps
 * only the keys this adapter actually implements.
 */
type CvmRemoteAdapter<Service> = Partial<RemoteService<Service>>;

const courseService = (client: RpcClient) =>
  ({
    _tag: "CourseOperationsService",
    getCourses: rpcMethod((json) =>
      client.rpc.course.getCourses.$post({ json })
    ),
    getArchivedCourses: rpcMethod((json) =>
      client.rpc.course.getArchivedCourses.$post({ json })
    ),
    getCourseById: rpcMethod((json) =>
      client.rpc.course.getCourseById.$post({ json })
    ),
    getCourseWithSlimClipsById: rpcMethod((json) =>
      client.rpc.course.getCourseWithSlimClipsById.$post({ json })
    ),
    getVideoTranscripts: rpcMethod((json) =>
      client.rpc.course.getVideoTranscripts.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<CourseOperationsService>;

const versionService = (client: RpcClient) =>
  ({
    _tag: "VersionOperationsService",
    getCourseVersions: rpcMethod((json) =>
      client.rpc.version.getCourseVersions.$post({ json })
    ),
    getCourseVersionById: rpcMethod((json) =>
      client.rpc.version.getCourseVersionById.$post({ json })
    ),
    getLatestCourseVersion: rpcMethod((json) =>
      client.rpc.version.getLatestCourseVersion.$post({ json })
    ),
    getVersionWithSections: rpcMethod((json) =>
      client.rpc.version.getVersionWithSections.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<VersionOperationsService>;

/**
 * Sections and Lessons are two nouns to an agent but one service here, so this
 * object spans the `/rpc/section` and `/rpc/lesson` groups.
 */
const lessonSectionService = (client: RpcClient) =>
  ({
    _tag: "LessonSectionOperationsService",
    getSectionsByRepoVersionId: rpcMethod((json) =>
      client.rpc.section.getSectionsByRepoVersionId.$post({ json })
    ),
    getSectionWithHierarchyById: rpcMethod((json) =>
      client.rpc.section.getSectionWithHierarchyById.$post({ json })
    ),
    createSections: rpcMethod((json) =>
      client.rpc.section.createSections.$post({ json })
    ),
    updateSectionTitle: rpcMethod((json) =>
      client.rpc.section.updateSectionTitle.$post({ json })
    ),
    archiveSection: rpcMethod((json) =>
      client.rpc.section.archiveSection.$post({ json })
    ),
    batchUpdateSectionOrders: rpcMethod((json) =>
      client.rpc.section.batchUpdateSectionOrders.$post({ json })
    ),
    getLessonsBySectionId: rpcMethod((json) =>
      client.rpc.lesson.getLessonsBySectionId.$post({ json })
    ),
    getLessonById: rpcMethod((json) =>
      client.rpc.lesson.getLessonById.$post({ json })
    ),
    getLessonWithHierarchyById: rpcMethod((json) =>
      client.rpc.lesson.getLessonWithHierarchyById.$post({ json })
    ),
    createLesson: rpcMethod((json) =>
      client.rpc.lesson.createLesson.$post({ json })
    ),
    updateLesson: rpcMethod((json) =>
      client.rpc.lesson.updateLesson.$post({ json })
    ),
    batchUpdateLessonOrders: rpcMethod((json) =>
      client.rpc.lesson.batchUpdateLessonOrders.$post({ json })
    ),
    deleteLesson: rpcMethod((json) =>
      client.rpc.lesson.deleteLesson.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<LessonSectionOperationsService>;

/**
 * `cvm lesson move` and `cvm section move` — structural writes, in their
 * respective route groups with the rest of that noun's verbs.
 */
const courseWriteService = (client: RpcClient) =>
  ({
    _tag: "CourseWriteService",
    reorderLessons: rpcMethod((json) =>
      client.rpc.lesson.reorderLessons.$post({ json })
    ),
    moveToSection: rpcMethod((json) =>
      client.rpc.lesson.moveToSection.$post({ json })
    ),
    reorderSections: rpcMethod((json) =>
      client.rpc.section.reorderSections.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<CourseWriteService>;

const videoService = (client: RpcClient) =>
  ({
    _tag: "VideoOperationsService",
    getAllStandaloneVideos: rpcMethod((json) =>
      client.rpc.video.getAllStandaloneVideos.$post({ json })
    ),
    getArchivedStandaloneVideos: rpcMethod((json) =>
      client.rpc.video.getArchivedStandaloneVideos.$post({ json })
    ),
    getVideoRowById: rpcMethod((json) =>
      client.rpc.video.getVideoRowById.$post({ json })
    ),
    getVideoWithClipsById: rpcMethod((json) =>
      client.rpc.video.getVideoWithClipsById.$post({ json })
    ),
    getVideoDeepById: rpcMethod((json) =>
      client.rpc.video.getVideoDeepById.$post({ json })
    ),
    createVideo: rpcMethod((json) =>
      client.rpc.video.createVideo.$post({ json })
    ),
    createStandaloneVideo: rpcMethod((json) =>
      client.rpc.video.createStandaloneVideo.$post({ json })
    ),
    linkVideoToPitch: rpcMethod((json) =>
      client.rpc.video.linkVideoToPitch.$post({ json })
    ),
    moveVideoToLesson: rpcMethod((json) =>
      client.rpc.video.moveVideoToLesson.$post({ json })
    ),
    updateVideoTitle: rpcMethod((json) =>
      client.rpc.video.updateVideoTitle.$post({ json })
    ),
    updateVideoBody: rpcMethod((json) =>
      client.rpc.video.updateVideoBody.$post({ json })
    ),
    updateVideoDescription: rpcMethod((json) =>
      client.rpc.video.updateVideoDescription.$post({ json })
    ),
    updateVideoScript: rpcMethod((json) =>
      client.rpc.video.updateVideoScript.$post({ json })
    ),
    updateVideoFormat: rpcMethod((json) =>
      client.rpc.video.updateVideoFormat.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<VideoOperationsService>;

const clipService = (client: RpcClient) =>
  ({
    _tag: "ClipOperationsService",
    getClipsByIds: rpcMethod((json) =>
      client.rpc.clip.getClipsByIds.$post({ json })
    ),
    listTimelineOrder: rpcMethod((json) =>
      client.rpc.clip.listTimelineOrder.$post({ json })
    ),
    createClip: rpcMethod((json) => client.rpc.clip.createClip.$post({ json })),
    updateClip: rpcMethod((json) => client.rpc.clip.updateClip.$post({ json })),
    retimeClip: rpcMethod((json) => client.rpc.clip.retimeClip.$post({ json })),
    setClipZoom: rpcMethod((json) =>
      client.rpc.clip.setClipZoom.$post({ json })
    ),
    moveClipToPosition: rpcMethod((json) =>
      client.rpc.clip.moveClipToPosition.$post({ json })
    ),
    archiveClip: rpcMethod((json) =>
      client.rpc.clip.archiveClip.$post({ json })
    ),
    listTranscriptWords: rpcMethod((json) =>
      client.rpc.clip.listTranscriptWords.$post({ json })
    ),
    replaceTranscriptWords: rpcMethod((json) =>
      client.rpc.clip.replaceTranscriptWords.$post({ json })
    ),
    // Chapters live on this same service (ClipOperationsService merges the
    // chapter ops in), so `cvm chapter`'s verbs are RPC methods here too, backed
    // by the /rpc/chapter route group.
    getChaptersByIds: rpcMethod((json) =>
      client.rpc.chapter.getChaptersByIds.$post({ json })
    ),
    listChaptersByVideoId: rpcMethod((json) =>
      client.rpc.chapter.listChaptersByVideoId.$post({ json })
    ),
    createChapterAtItem: rpcMethod((json) =>
      client.rpc.chapter.createChapterAtItem.$post({ json })
    ),
    updateChapter: rpcMethod((json) =>
      client.rpc.chapter.updateChapter.$post({ json })
    ),
    moveChapterToPosition: rpcMethod((json) =>
      client.rpc.chapter.moveChapterToPosition.$post({ json })
    ),
    archiveChapter: rpcMethod((json) =>
      client.rpc.chapter.archiveChapter.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<ClipOperationsService>;

const overlayService = (client: RpcClient) =>
  ({
    _tag: "OverlayOperationsService",
    listOverlaysByVideoId: rpcMethod((json) =>
      client.rpc.overlay.listOverlaysByVideoId.$post({ json })
    ),
    getOverlaysByIds: rpcMethod((json) =>
      client.rpc.overlay.getOverlaysByIds.$post({ json })
    ),
    createOverlay: rpcMethod((json) =>
      client.rpc.overlay.createOverlay.$post({ json })
    ),
    updateOverlay: rpcMethod((json) =>
      client.rpc.overlay.updateOverlay.$post({ json })
    ),
    deleteOverlay: rpcMethod((json) =>
      client.rpc.overlay.deleteOverlay.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<OverlayOperationsService>;

const beatService = (client: RpcClient) =>
  ({
    _tag: "BeatOperationsService",
    listBeatsByVideoId: rpcMethod((json) =>
      client.rpc.beat.listBeatsByVideoId.$post({ json })
    ),
    listBeatsByScope: rpcMethod((json) =>
      client.rpc.beat.listBeatsByScope.$post({ json })
    ),
    getBeatById: rpcMethod((json) =>
      client.rpc.beat.getBeatById.$post({ json })
    ),
    createBeat: rpcMethod((json) => client.rpc.beat.createBeat.$post({ json })),
    renameBeat: rpcMethod((json) => client.rpc.beat.renameBeat.$post({ json })),
    setBeatDescription: rpcMethod((json) =>
      client.rpc.beat.setBeatDescription.$post({ json })
    ),
    setBeatKind: rpcMethod((json) =>
      client.rpc.beat.setBeatKind.$post({ json })
    ),
    setBeatLearningGoals: rpcMethod((json) =>
      client.rpc.beat.setBeatLearningGoals.$post({ json })
    ),
    moveBeat: rpcMethod((json) => client.rpc.beat.moveBeat.$post({ json })),
    deleteBeat: rpcMethod((json) => client.rpc.beat.deleteBeat.$post({ json })),
  }) satisfies CvmRemoteAdapter<BeatOperationsService>;

const learningGoalService = (client: RpcClient) =>
  ({
    _tag: "LearningGoalOperationsService",
    listLearningGoalsBySectionId: rpcMethod((json) =>
      client.rpc["learning-goal"].listLearningGoalsBySectionId.$post({ json })
    ),
    getLearningGoalById: rpcMethod((json) =>
      client.rpc["learning-goal"].getLearningGoalById.$post({ json })
    ),
    createLearningGoal: rpcMethod((json) =>
      client.rpc["learning-goal"].createLearningGoal.$post({ json })
    ),
    updateLearningGoal: rpcMethod((json) =>
      client.rpc["learning-goal"].updateLearningGoal.$post({ json })
    ),
    moveLearningGoal: rpcMethod((json) =>
      client.rpc["learning-goal"].moveLearningGoal.$post({ json })
    ),
    unlinkBeat: rpcMethod((json) =>
      client.rpc["learning-goal"].unlinkBeat.$post({ json })
    ),
    deleteLearningGoal: rpcMethod((json) =>
      client.rpc["learning-goal"].deleteLearningGoal.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<LearningGoalOperationsService>;

const pitchService = (client: RpcClient) =>
  ({
    _tag: "PitchOperationsService",
    listPitches: rpcMethod((json) =>
      client.rpc.pitch.listPitches.$post({ json })
    ),
    getPitch: rpcMethod((json) => client.rpc.pitch.getPitch.$post({ json })),
    getPitchWithVideos: rpcMethod((json) =>
      client.rpc.pitch.getPitchWithVideos.$post({ json })
    ),
    createPitch: rpcMethod((json) =>
      client.rpc.pitch.createPitch.$post({ json })
    ),
    updatePitch: rpcMethod((json) =>
      client.rpc.pitch.updatePitch.$post({ json })
    ),
    createVideoFromPitch: rpcMethod((json) =>
      client.rpc.pitch.createVideoFromPitch.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<PitchOperationsService>;

const deliverableService = (client: RpcClient) =>
  ({
    _tag: "DeliverableOperationsService",
    listDeliverables: rpcMethod((json) =>
      client.rpc.deliverable.listDeliverables.$post({ json })
    ),
    getDeliverableById: rpcMethod((json) =>
      client.rpc.deliverable.getDeliverableById.$post({ json })
    ),
    createDeliverable: rpcMethod((json) =>
      client.rpc.deliverable.createDeliverable.$post({ json })
    ),
    updateDeliverable: rpcMethod((json) =>
      client.rpc.deliverable.updateDeliverable.$post({ json })
    ),
    archiveDeliverable: rpcMethod((json) =>
      client.rpc.deliverable.archiveDeliverable.$post({ json })
    ),
  }) satisfies CvmRemoteAdapter<DeliverableOperationsService>;

const searchService = (client: RpcClient) =>
  ({
    _tag: "SearchOperationsService",
    // The one method that cannot use `rpcMethod`: `types` is a Set in the
    // service and a Set is not JSON, so this call site converts it and the
    // matching route in apps/remote/routes/search.ts converts it back.
    search: (params) =>
      callRpc((json) => client.rpc.search.search.$post({ json }), {
        root: params.root,
        query: params.query,
        types: [...params.types],
      }),
  }) satisfies CvmRemoteAdapter<SearchOperationsService>;

/** The CLI's RPC-only service tags, each exposing its mapped adapter shape. */
export const CvmSearchOperationsService = Context.GenericTag<
  "CvmSearchOperationsService",
  ReturnType<typeof searchService>
>("CvmSearchOperationsService");
export const CvmCourseOperationsService = Context.GenericTag<
  "CvmCourseOperationsService",
  ReturnType<typeof courseService>
>("CvmCourseOperationsService");
export const CvmVersionOperationsService = Context.GenericTag<
  "CvmVersionOperationsService",
  ReturnType<typeof versionService>
>("CvmVersionOperationsService");
export const CvmLessonSectionOperationsService = Context.GenericTag<
  "CvmLessonSectionOperationsService",
  ReturnType<typeof lessonSectionService>
>("CvmLessonSectionOperationsService");
export const CvmLearningGoalOperationsService = Context.GenericTag<
  "CvmLearningGoalOperationsService",
  ReturnType<typeof learningGoalService>
>("CvmLearningGoalOperationsService");
export const CvmVideoOperationsService = Context.GenericTag<
  "CvmVideoOperationsService",
  ReturnType<typeof videoService>
>("CvmVideoOperationsService");
export const CvmClipOperationsService = Context.GenericTag<
  "CvmClipOperationsService",
  ReturnType<typeof clipService>
>("CvmClipOperationsService");
export const CvmOverlayOperationsService = Context.GenericTag<
  "CvmOverlayOperationsService",
  ReturnType<typeof overlayService>
>("CvmOverlayOperationsService");
export const CvmBeatOperationsService = Context.GenericTag<
  "CvmBeatOperationsService",
  ReturnType<typeof beatService>
>("CvmBeatOperationsService");
export const CvmPitchOperationsService = Context.GenericTag<
  "CvmPitchOperationsService",
  ReturnType<typeof pitchService>
>("CvmPitchOperationsService");
export const CvmDeliverableOperationsService = Context.GenericTag<
  "CvmDeliverableOperationsService",
  ReturnType<typeof deliverableService>
>("CvmDeliverableOperationsService");
export const CvmCourseWriteService = Context.GenericTag<
  "CvmCourseWriteService",
  ReturnType<typeof courseWriteService>
>("CvmCourseWriteService");

/** Every CLI RPC service environment the transport layer provides. */
export type RemoteServices =
  | Context.Tag.Identifier<typeof CvmSearchOperationsService>
  | Context.Tag.Identifier<typeof CvmCourseOperationsService>
  | Context.Tag.Identifier<typeof CvmVersionOperationsService>
  | Context.Tag.Identifier<typeof CvmLessonSectionOperationsService>
  | Context.Tag.Identifier<typeof CvmLearningGoalOperationsService>
  | Context.Tag.Identifier<typeof CvmVideoOperationsService>
  | Context.Tag.Identifier<typeof CvmClipOperationsService>
  | Context.Tag.Identifier<typeof CvmOverlayOperationsService>
  | Context.Tag.Identifier<typeof CvmBeatOperationsService>
  | Context.Tag.Identifier<typeof CvmPitchOperationsService>
  | Context.Tag.Identifier<typeof CvmDeliverableOperationsService>
  | Context.Tag.Identifier<typeof CvmCourseWriteService>;

/**
 * One RPC-backed service under its dedicated CLI tag.
 */
const remoteLayer = <I, Service>(
  tag: Context.Tag<I, Service>,
  service: Service
): Layer.Layer<I> => Layer.succeed(tag, service);

export const makeRemoteLayer = (
  config: RpcClientConfig
): Layer.Layer<RemoteServices> => {
  const client = makeRpcClient(config);

  return Layer.mergeAll(
    remoteLayer(CvmSearchOperationsService, searchService(client)),
    remoteLayer(CvmCourseOperationsService, courseService(client)),
    remoteLayer(CvmVersionOperationsService, versionService(client)),
    remoteLayer(
      CvmLessonSectionOperationsService,
      lessonSectionService(client)
    ),
    remoteLayer(CvmLearningGoalOperationsService, learningGoalService(client)),
    remoteLayer(CvmVideoOperationsService, videoService(client)),
    remoteLayer(CvmClipOperationsService, clipService(client)),
    remoteLayer(CvmOverlayOperationsService, overlayService(client)),
    remoteLayer(CvmBeatOperationsService, beatService(client)),
    remoteLayer(CvmPitchOperationsService, pitchService(client)),
    remoteLayer(CvmDeliverableOperationsService, deliverableService(client)),
    remoteLayer(CvmCourseWriteService, courseWriteService(client))
  );
};
