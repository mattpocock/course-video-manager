import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  input: "json",
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      const preserved =
        typeof body.preserved === "boolean" ? body.preserved : undefined;
      const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
      const thumbnailBase64 =
        typeof body.thumbnailPngBase64 === "string"
          ? body.thumbnailPngBase64
          : undefined;

      if (preserved && !thumbnailBase64) {
        return yield* Effect.die(
          data("Preserved snapshots require a thumbnail", { status: 400 })
        );
      }

      let thumbnailPng: Buffer | undefined;
      if (thumbnailBase64) {
        try {
          thumbnailPng = Buffer.from(thumbnailBase64, "base64");
        } catch {
          return yield* Effect.die(
            data("Invalid thumbnail encoding", { status: 400 })
          );
        }
      }

      const diagramOps = yield* DiagramOperationsService;

      let snapshot;
      if (clipId) {
        snapshot = yield* diagramOps.createSnapshotForClip(
          params.diagramId!,
          clipId,
          { thumbnailPng }
        );
      } else {
        snapshot = yield* diagramOps.createSnapshot(params.diagramId!, {
          preserved,
          thumbnailPng,
        });
      }

      return data({ snapshot });
    }),
});
