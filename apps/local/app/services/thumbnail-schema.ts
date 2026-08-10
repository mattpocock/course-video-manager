import { Schema } from "effect";

const LayerPosition = Schema.Struct({
  filePath: Schema.String,
  horizontalPosition: Schema.Number,
});

export const ThumbnailLayersSchema = Schema.Struct({
  backgroundPhoto: LayerPosition,
  diagram: Schema.NullOr(LayerPosition),
  cutout: Schema.NullOr(LayerPosition),
});

export type ThumbnailLayers = typeof ThumbnailLayersSchema.Type;
