import { Context, Layer } from "effect";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
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
 *   the SIGNATURE  `satisfies RemoteService<T>` checks each method against the
 *                  service's own declaration in `@cvm/core`;
 *   the ARGUMENTS  `rpcMethod` forwards them variadically, so there is nowhere
 *                  for a hand-written call to reorder or drop one.
 *
 * THE ONE CAST, and it is literally one — see `remoteLayer` at the bottom of
 * this file. An RPC-backed service reaches `Layer.succeed` through a cast,
 * because over HTTP every method's failure channel also carries
 * AuthenticationError and TransportError, and Effect's error channel does not
 * widen on assignment. The CLI renderer dispatches on `_tag` and handles an
 * unknown tag defensively, so the mismatch is contained to that one line
 * rather than rippling through every command signature. That is the price of
 * the services keeping their tags across the move to HTTP, and it is worth
 * paying: no command handler changed.
 */

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
  }) satisfies RemoteService<CourseOperationsService>;

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
  }) satisfies RemoteService<VersionOperationsService>;

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
  }) satisfies RemoteService<LessonSectionOperationsService>;

/** `cvm lesson move` — structural writes, in the `lesson` group with them. */
const courseWriteService = (client: RpcClient) =>
  ({
    _tag: "CourseWriteService",
    reorderLessons: rpcMethod((json) =>
      client.rpc.lesson.reorderLessons.$post({ json })
    ),
    moveToSection: rpcMethod((json) =>
      client.rpc.lesson.moveToSection.$post({ json })
    ),
  }) satisfies RemoteService<CourseWriteService>;

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
  }) satisfies RemoteService<VideoOperationsService>;

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
  }) satisfies RemoteService<ClipOperationsService>;

const beatService = (client: RpcClient) =>
  ({
    _tag: "BeatOperationsService",
    listBeatsByVideoId: rpcMethod((json) =>
      client.rpc.beat.listBeatsByVideoId.$post({ json })
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
    moveBeat: rpcMethod((json) => client.rpc.beat.moveBeat.$post({ json })),
    deleteBeat: rpcMethod((json) => client.rpc.beat.deleteBeat.$post({ json })),
  }) satisfies RemoteService<BeatOperationsService>;

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
  }) satisfies RemoteService<PitchOperationsService>;

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
  }) satisfies RemoteService<DeliverableOperationsService>;

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
  }) satisfies RemoteService<SearchOperationsService>;

/** Every domain service the `cvm` CLI reaches over HTTP. */
export type RemoteServices =
  | SearchOperationsService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | VideoOperationsService
  | ClipOperationsService
  | BeatOperationsService
  | PitchOperationsService
  | DeliverableOperationsService
  | CourseWriteService;

/**
 * One RPC-backed service, as the layer that hands it out under the tag the
 * command handlers already ask for.
 *
 * This is where the cast the doc block above describes lives, and it is the
 * only one in the file: `satisfies RemoteService<T>` on each service object has
 * already checked every method against the service's own declaration, so all
 * that is left here is widening a failure channel Effect will not widen by
 * itself. Written once, it cannot drift between the ten call sites — and a
 * service object handed to the wrong tag is still a compile error, because
 * `build` is typed by the tag it is given.
 */
const remoteLayer = <I, S>(
  tag: Context.Tag<I, S>,
  build: (client: RpcClient) => RemoteService<S>,
  client: RpcClient
): Layer.Layer<I> => Layer.succeed(tag, build(client) as S);

export const makeRemoteLayer = (
  config: RpcClientConfig
): Layer.Layer<RemoteServices> => {
  const client = makeRpcClient(config);

  return Layer.mergeAll(
    remoteLayer(SearchOperationsService, searchService, client),
    remoteLayer(CourseOperationsService, courseService, client),
    remoteLayer(VersionOperationsService, versionService, client),
    remoteLayer(LessonSectionOperationsService, lessonSectionService, client),
    remoteLayer(VideoOperationsService, videoService, client),
    remoteLayer(ClipOperationsService, clipService, client),
    remoteLayer(BeatOperationsService, beatService, client),
    remoteLayer(PitchOperationsService, pitchService, client),
    remoteLayer(DeliverableOperationsService, deliverableService, client),
    remoteLayer(CourseWriteService, courseWriteService, client)
  );
};
