import { BeatOperationsService } from "@cvm/core/services/db-beat-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `beat` verb group: `cvm beat list | add | update | move | delete`.
 *
 * `update` is four routes because it is four service methods — the CLI
 * applies whichever of --title / --description / --kind / --learning-goal it
 * was given, and the API is its transport, not a patch endpoint.
 */
export const beatRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listBeatsByVideoId",
      forward(runtime, BeatOperationsService, "listBeatsByVideoId")
    )
    .post(
      "/getBeatById",
      forward(runtime, BeatOperationsService, "getBeatById")
    )
    .post("/createBeat", forward(runtime, BeatOperationsService, "createBeat"))
    .post("/renameBeat", forward(runtime, BeatOperationsService, "renameBeat"))
    .post(
      "/setBeatDescription",
      forward(runtime, BeatOperationsService, "setBeatDescription")
    )
    .post(
      "/setBeatKind",
      forward(runtime, BeatOperationsService, "setBeatKind")
    )
    .post(
      "/setBeatLearningGoals",
      forward(runtime, BeatOperationsService, "setBeatLearningGoals")
    )
    .post("/moveBeat", forward(runtime, BeatOperationsService, "moveBeat"))
    .post("/deleteBeat", forward(runtime, BeatOperationsService, "deleteBeat"));
