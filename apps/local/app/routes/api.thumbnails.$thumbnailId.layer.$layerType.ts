import { createReadStream } from "fs";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
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

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      if (!VALID_LAYER_TYPES.includes(params.layerType as LayerType)) {
        return yield* Effect.die(
          data("Invalid layer type. Must be: bg, diagram, cutout", {
            status: 400,
          })
        );
      }

      const thumbnailOps = yield* ThumbnailOperationsService;
      const record = yield* thumbnailOps.getThumbnailById(params.thumbnailId!);

      const layers = record.layers as {
        backgroundPhoto: { filePath: string };
        diagram: { filePath: string } | null;
        cutout: { filePath: string } | null;
      };

      const filePath = getLayerFilePath(layers, params.layerType as LayerType);

      if (!filePath) {
        return yield* Effect.die(
          data(`No ${params.layerType} layer exists for this thumbnail`, {
            status: 404,
          })
        );
      }

      return new Response(createReadStream(filePath) as any, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    }),
});
