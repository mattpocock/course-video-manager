import { VideoOperationsService } from "@cvm/core/services/db-video-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc";
import type { RemoteRuntime } from "../runtime";

/**
 * The `video` verb group: `cvm video list | get | tree | transcript | script |
 * create | move | update`.
 *
 * `getVideoDeepById` is here for `cvm file`, which resolves a Video's
 * `lineageId` over HTTP and then reads the Video Files directory off local
 * disk — domain data over the wire, bytes off the machine.
 */
export const videoRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/getAllStandaloneVideos",
      forward(runtime, VideoOperationsService, "getAllStandaloneVideos")
    )
    .post(
      "/getArchivedStandaloneVideos",
      forward(runtime, VideoOperationsService, "getArchivedStandaloneVideos")
    )
    .post(
      "/getVideoRowById",
      forward(runtime, VideoOperationsService, "getVideoRowById")
    )
    .post(
      "/getVideoWithClipsById",
      forward(runtime, VideoOperationsService, "getVideoWithClipsById")
    )
    .post(
      "/getVideoDeepById",
      forward(runtime, VideoOperationsService, "getVideoDeepById")
    )
    .post(
      "/createVideo",
      forward(runtime, VideoOperationsService, "createVideo")
    )
    .post(
      "/createStandaloneVideo",
      forward(runtime, VideoOperationsService, "createStandaloneVideo")
    )
    .post(
      "/linkVideoToPitch",
      forward(runtime, VideoOperationsService, "linkVideoToPitch")
    )
    .post(
      "/moveVideoToLesson",
      forward(runtime, VideoOperationsService, "moveVideoToLesson")
    )
    .post(
      "/updateVideoTitle",
      forward(runtime, VideoOperationsService, "updateVideoTitle")
    )
    .post(
      "/updateVideoBody",
      forward(runtime, VideoOperationsService, "updateVideoBody")
    )
    .post(
      "/updateVideoDescription",
      forward(runtime, VideoOperationsService, "updateVideoDescription")
    )
    .post(
      "/updateVideoScript",
      forward(runtime, VideoOperationsService, "updateVideoScript")
    )
    .post(
      "/updateVideoFormat",
      forward(runtime, VideoOperationsService, "updateVideoFormat")
    );
