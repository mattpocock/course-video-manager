import { DeliverableOperationsService } from "@cvm/core/services/db-deliverable-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `deliverable` verb group: `cvm deliverable list | get | create | update |
 * archive` — the Deliverables Calendar, maintained from anywhere.
 */
export const deliverableRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/listDeliverables",
      forward(runtime, DeliverableOperationsService, "listDeliverables")
    )
    .post(
      "/getDeliverableById",
      forward(runtime, DeliverableOperationsService, "getDeliverableById")
    )
    .post(
      "/createDeliverable",
      forward(runtime, DeliverableOperationsService, "createDeliverable")
    )
    .post(
      "/updateDeliverable",
      forward(runtime, DeliverableOperationsService, "updateDeliverable")
    )
    .post(
      "/archiveDeliverable",
      forward(runtime, DeliverableOperationsService, "archiveDeliverable")
    );
