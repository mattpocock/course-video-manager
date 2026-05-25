import { createReadStream } from "fs";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.layer.$layerType";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { data } from "react-router";

const VALID_LAYER_TYPES = ["bg", "diagram", "cutout"] as const;
type LayerType = (typeof VALID_LAYER_TYPES)[number];

function getLayerFilePath(
  layers: {
    backgroundPhoto: { filePath: string };
    diagram: { filePath: string } | null;
    cutout: { filePath: string } | null;
  },
  layerType: LayerType
): string | null {
  switch (layerType) {
    case "bg":
      return layers.backgroundPhoto.filePath;
    case "diagram":
      return layers.diagram?.filePath ?? null;
    case "cutout":
      return layers.cutout?.filePath ?? null;
  }
}

export const loader = async (args: Route.LoaderArgs) => {
  const { thumbnailId, layerType } = args.params;

  return Effect.gen(function* () {
    if (!VALID_LAYER_TYPES.includes(layerType as LayerType)) {
      return yield* Effect.die(
        data("Invalid layer type. Must be: bg, diagram, cutout", {
          status: 400,
        })
      );
    }

    const thumbnailOps = yield* ThumbnailOperationsService;
    const record = yield* thumbnailOps.getThumbnailById(thumbnailId);

    const layers = record.layers as {
      backgroundPhoto: { filePath: string };
      diagram: { filePath: string } | null;
      cutout: { filePath: string } | null;
    };

    const filePath = getLayerFilePath(layers, layerType as LayerType);

    if (!filePath) {
      return yield* Effect.die(
        data(`No ${layerType} layer exists for this thumbnail`, { status: 404 })
      );
    }

    return new Response(createReadStream(filePath) as any, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Thumbnail not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
