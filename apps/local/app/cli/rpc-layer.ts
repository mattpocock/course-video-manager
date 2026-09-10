import { Context, Layer } from "effect";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { LearningGoalOperationsService } from "@/services/db-learning-goal-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
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
 * The services keep their existing TAGS and their existing SIGNATURES, so no
 * command handler knows or cares that the work now happens on another machine —
 * swapping the layer is the whole change, and every `cli-*` test asserts on
 * exactly what it asserted on before.
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
 *   the SIGNATURE  the required `CvmRemoteAdapter` method set checks each
 *                  method against the service's own declaration in
 *                  `@cvm/core`, and rejects an omitted `cvm` call;
 *   the ARGUMENTS  `rpcMethod` forwards them variadically, so there is nowhere
 *                  for a hand-written call to reorder or drop one.
 *
 * THE ONE CAST, and it is literally one — see `remoteLayer` at the bottom of
 * this file. It narrows the existing domain tag to its checked adapter shape;
 * it never turns the adapter into the full domain service. That is necessary
 * because over HTTP every selected method's failure channel also carries
 * AuthenticationError and TransportError, and Effect's error channel does not
 * widen on assignment. Each adapter's required mapping still rejects an
 * omitted `cvm` call. The CLI renderer dispatches on `_tag` and handles an
 * unknown tag defensively, so the mismatch is contained to that one line
 * rather than rippling through every command signature.
 */

/**
 * The required methods one domain service exposes through `cvm`.
 *
 * A service's other domain methods need no remote route. `_tag` remains part
 * of the value handed to Effect's existing service tag.
 */
type CvmRemoteAdapter<Service, Methods extends keyof Service> = RemoteService<
  Pick<Service, Methods | Extract<"_tag", keyof Service>>
>;

type CourseRemoteAdapter = CvmRemoteAdapter<
  CourseOperationsService,
  | "getCourses"
  | "getArchivedCourses"
  | "getCourseById"
  | "getCourseWithSlimClipsById"
  | "getVideoTranscripts"
>;

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
  }) satisfies CourseRemoteAdapter;

type VersionRemoteAdapter = CvmRemoteAdapter<
  VersionOperationsService,
  | "getCourseVersions"
  | "getCourseVersionById"
  | "getLatestCourseVersion"
  | "getVersionWithSections"
>;

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
  }) satisfies VersionRemoteAdapter;

/**
 * Sections and Lessons are two nouns to an agent but one service here, so this
 * object spans the `/rpc/section` and `/rpc/lesson` groups.
 */
type LessonSectionRemoteAdapter = CvmRemoteAdapter<
  LessonSectionOperationsService,
  | "getSectionsByRepoVersionId"
  | "getSectionWithHierarchyById"
  | "createSections"
  | "updateSectionTitle"
  | "archiveSection"
  | "batchUpdateSectionOrders"
  | "getLessonsBySectionId"
  | "getLessonById"
  | "getLessonWithHierarchyById"
  | "createLesson"
  | "updateLesson"
  | "batchUpdateLessonOrders"
  | "deleteLesson"
>;

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
  }) satisfies LessonSectionRemoteAdapter;

/**
 * `cvm lesson move` and `cvm section move` — structural writes, in their
 * respective route groups with the rest of that noun's verbs.
 */
type CourseWriteRemoteAdapter = CvmRemoteAdapter<
  CourseWriteService,
  "reorderLessons" | "moveToSection" | "reorderSections"
>;

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
  }) satisfies CourseWriteRemoteAdapter;

type VideoRemoteAdapter = CvmRemoteAdapter<
  VideoOperationsService,
  | "getAllStandaloneVideos"
  | "getArchivedStandaloneVideos"
  | "getVideoRowById"
  | "getVideoWithClipsById"
  | "getVideoDeepById"
  | "createVideo"
  | "createStandaloneVideo"
  | "linkVideoToPitch"
  | "moveVideoToLesson"
  | "updateVideoTitle"
  | "updateVideoBody"
  | "updateVideoDescription"
  | "updateVideoScript"
  | "updateVideoFormat"
>;

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
  }) satisfies VideoRemoteAdapter;

type ClipRemoteAdapter = CvmRemoteAdapter<
  ClipOperationsService,
  | "getClipsByIds"
  | "listTimelineOrder"
  | "createClip"
  | "updateClip"
  | "retimeClip"
  | "setClipZoom"
  | "moveClipToPosition"
  | "archiveClip"
  | "listTranscriptWords"
  | "replaceTranscriptWords"
  | "getChaptersByIds"
  | "listChaptersByVideoId"
  | "createChapterAtItem"
  | "updateChapter"
  | "moveChapterToPosition"
  | "archiveChapter"
>;

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
  }) satisfies ClipRemoteAdapter;

type OverlayRemoteAdapter = CvmRemoteAdapter<
  OverlayOperationsService,
  | "listOverlaysByVideoId"
  | "getOverlaysByIds"
  | "createOverlay"
  | "updateOverlay"
  | "deleteOverlay"
>;

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
  }) satisfies OverlayRemoteAdapter;

type BeatRemoteAdapter = CvmRemoteAdapter<
  BeatOperationsService,
  | "listBeatsByVideoId"
  | "listBeatsByScope"
  | "getBeatById"
  | "createBeat"
  | "renameBeat"
  | "setBeatDescription"
  | "setBeatKind"
  | "setBeatLearningGoals"
  | "moveBeat"
  | "deleteBeat"
>;

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
  }) satisfies BeatRemoteAdapter;

type LearningGoalRemoteAdapter = CvmRemoteAdapter<
  LearningGoalOperationsService,
  | "listLearningGoalsBySectionId"
  | "getLearningGoalById"
  | "createLearningGoal"
  | "updateLearningGoal"
  | "moveLearningGoal"
  | "unlinkBeat"
  | "deleteLearningGoal"
>;

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
  }) satisfies LearningGoalRemoteAdapter;

type PitchRemoteAdapter = CvmRemoteAdapter<
  PitchOperationsService,
  | "listPitches"
  | "getPitch"
  | "getPitchWithVideos"
  | "createPitch"
  | "updatePitch"
  | "createVideoFromPitch"
>;

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
  }) satisfies PitchRemoteAdapter;

type DeliverableRemoteAdapter = CvmRemoteAdapter<
  DeliverableOperationsService,
  | "listDeliverables"
  | "getDeliverableById"
  | "createDeliverable"
  | "updateDeliverable"
  | "archiveDeliverable"
>;

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
  }) satisfies DeliverableRemoteAdapter;

type SearchRemoteAdapter = CvmRemoteAdapter<SearchOperationsService, "search">;

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
  }) satisfies SearchRemoteAdapter;

/** Every domain service the `cvm` CLI reaches over HTTP. */
export type RemoteServices =
  | SearchOperationsService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | LearningGoalOperationsService
  | VideoOperationsService
  | ClipOperationsService
  | OverlayOperationsService
  | BeatOperationsService
  | PitchOperationsService
  | DeliverableOperationsService
  | CourseWriteService;

/**
 * One RPC-backed service, as the layer that hands it out under the tag the
 * command handlers already ask for.
 *
 * The adapter is required to cover a selected set of the tagged service's
 * methods. Its service tag is narrowed locally rather than casting the adapter
 * to the complete domain service: a mapping can therefore never manufacture an
 * unimplemented domain method merely to satisfy `Layer.succeed`.
 */
const remoteAdapterTag = <I, S, Methods extends keyof S>(
  tag: Context.Tag<I, S>
): Context.Tag<I, CvmRemoteAdapter<S, Methods>> =>
  // Tags are invariant in their service value. This relates the existing tag
  // to the adapter only; unlike the former cast, it cannot add adapter methods.
  tag as unknown as Context.Tag<I, CvmRemoteAdapter<S, Methods>>;

const remoteLayer = <I, S, Methods extends keyof S>(
  tag: Context.Tag<I, S>,
  build: (client: RpcClient) => CvmRemoteAdapter<S, Methods>,
  client: RpcClient
): Layer.Layer<I> =>
  Layer.succeed(remoteAdapterTag<I, S, Methods>(tag), build(client));

export const makeRemoteLayer = (
  config: RpcClientConfig
): Layer.Layer<RemoteServices> => {
  const client = makeRpcClient(config);

  return Layer.mergeAll(
    remoteLayer(SearchOperationsService, searchService, client),
    remoteLayer(CourseOperationsService, courseService, client),
    remoteLayer(VersionOperationsService, versionService, client),
    remoteLayer(LessonSectionOperationsService, lessonSectionService, client),
    remoteLayer(LearningGoalOperationsService, learningGoalService, client),
    remoteLayer(VideoOperationsService, videoService, client),
    remoteLayer(ClipOperationsService, clipService, client),
    remoteLayer(OverlayOperationsService, overlayService, client),
    remoteLayer(BeatOperationsService, beatService, client),
    remoteLayer(PitchOperationsService, pitchService, client),
    remoteLayer(DeliverableOperationsService, deliverableService, client),
    remoteLayer(CourseWriteService, courseWriteService, client)
  );
};
