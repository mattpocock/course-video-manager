import { PitchOperationsService } from "@cvm/core/services/db-pitch-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `pitch` verb group: `cvm pitch list | get | create | update`.
 *
 * `createVideoFromPitch` is here for `cvm beat add --pitch`, which authors a
 * Beat plan against a Pitch that has no Video yet.
 */
export const pitchRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listPitches",
      forward(runtime, PitchOperationsService, "listPitches")
    )
    .post("/getPitch", forward(runtime, PitchOperationsService, "getPitch"))
    .post(
      "/getPitchWithVideos",
      forward(runtime, PitchOperationsService, "getPitchWithVideos")
    )
    .post(
      "/createPitch",
      forward(runtime, PitchOperationsService, "createPitch")
    )
    .post(
      "/updatePitch",
      forward(runtime, PitchOperationsService, "updatePitch")
    )
    .post(
      "/createVideoFromPitch",
      forward(runtime, PitchOperationsService, "createVideoFromPitch")
    );
