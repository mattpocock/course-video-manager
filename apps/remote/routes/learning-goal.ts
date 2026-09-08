import { LearningGoalOperationsService } from "@cvm/core/services/db-learning-goal-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `learning-goal` verb group: `cvm learning-goal list | get | create |
 * update | move | delete`.
 *
 * `update` is one route because it is one service method — the CLI collects
 * whichever of --title / --description / --priority it was given into a
 * single patch, and the API is its transport, not a patch endpoint. Mirrors
 * `pitch`'s single-route update, not `beat`'s three.
 *
 * `unlinkBeat` backs `cvm learning-goal update --unlink-beat` — a single-link
 * removal from the Learning Goal side, the deliberate exception to `beatIds`
 * otherwise being read-only here (see db-learning-goal-operations.server.ts).
 */
export const learningGoalRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listLearningGoalsBySectionId",
      forward(
        runtime,
        LearningGoalOperationsService,
        "listLearningGoalsBySectionId"
      )
    )
    .post(
      "/getLearningGoalById",
      forward(runtime, LearningGoalOperationsService, "getLearningGoalById")
    )
    .post(
      "/createLearningGoal",
      forward(runtime, LearningGoalOperationsService, "createLearningGoal")
    )
    .post(
      "/updateLearningGoal",
      forward(runtime, LearningGoalOperationsService, "updateLearningGoal")
    )
    .post(
      "/moveLearningGoal",
      forward(runtime, LearningGoalOperationsService, "moveLearningGoal")
    )
    .post(
      "/unlinkBeat",
      forward(runtime, LearningGoalOperationsService, "unlinkBeat")
    )
    .post(
      "/deleteLearningGoal",
      forward(runtime, LearningGoalOperationsService, "deleteLearningGoal")
    );
