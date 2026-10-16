/**
 * Schema definitions for ClipService RPC events.
 * Used by the route handler to validate incoming requests.
 */

import { Schema } from "effect";
import {
  MIC_EQ_DB_RANGE,
  MIC_OFFSET_MS_RANGE,
  RECORDING_SESSION_SCENES,
} from "@cvm/core/features/videos/recorder";

export const InsertionPointSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("start"),
  }),
  Schema.Struct({
    type: Schema.Literal("after-clip"),
    databaseClipId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("after-chapter"),
    chapterId: Schema.String,
  })
);

const MicEqGainSchema = Schema.Number.pipe(
  Schema.between(MIC_EQ_DB_RANGE.min, MIC_EQ_DB_RANGE.max)
);

const ReorderDirectionSchema = Schema.Union(
  Schema.Literal("up"),
  Schema.Literal("down")
);

const PositionSchema = Schema.Union(
  Schema.Literal("before"),
  Schema.Literal("after")
);

const TargetItemTypeSchema = Schema.Union(
  Schema.Literal("clip"),
  Schema.Literal("chapter")
);

const ClipInputSchema = Schema.Struct({
  inputVideo: Schema.String,
  startTime: Schema.Number,
  endTime: Schema.Number,
});

const AppendClipsInputSchema = Schema.Struct({
  videoId: Schema.String,
  insertionPoint: InsertionPointSchema,
  clips: Schema.Array(ClipInputSchema),
});

const UpdateClipInputSchema = Schema.Struct({
  id: Schema.String,
  scene: Schema.String,
  profile: Schema.String,
  pauseType: Schema.String,
});

const CreateChapterAtInsertionPointInputSchema = Schema.Struct({
  videoId: Schema.String,
  name: Schema.String,
  insertionPoint: InsertionPointSchema,
});

const CreateChapterAtPositionInputSchema = Schema.Struct({
  videoId: Schema.String,
  name: Schema.String,
  position: PositionSchema,
  targetItemId: Schema.String,
  targetItemType: TargetItemTypeSchema,
});

const CreateEffectClipAtPositionInputSchema = Schema.Struct({
  videoId: Schema.String,
  position: PositionSchema,
  targetItemId: Schema.String,
  targetItemType: TargetItemTypeSchema,
  videoFilename: Schema.String,
  sourceStartTime: Schema.Number,
  sourceEndTime: Schema.Number,
  text: Schema.String,
  scene: Schema.String,
  profile: Schema.String,
  pauseType: Schema.String,
});

const CreateVideoFromSelectionModeSchema = Schema.Union(
  Schema.Literal("copy"),
  Schema.Literal("move")
);

const AutofillChaptersInputSchema = Schema.Struct({
  videoId: Schema.String,
  sections: Schema.Array(
    Schema.Struct({
      beforeClipId: Schema.String,
      title: Schema.String,
    })
  ),
});

const CreateVideoFromSelectionInputSchema = Schema.Struct({
  sourceVideoId: Schema.String,
  clipIds: Schema.Array(Schema.String),
  chapterIds: Schema.Array(Schema.String),
  title: Schema.String,
  mode: CreateVideoFromSelectionModeSchema,
});

/**
 * Schema for validating ClipServiceEvent in the route handler.
 * This is a discriminated union matching all possible event types.
 */
export const ClipServiceEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("create-video"),
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("get-timeline"),
    videoId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("get-footage-stats"),
    now: Schema.String,
    timeZone: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("append-clips"),
    input: AppendClipsInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("archive-clips"),
    clipIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("unarchive-clips"),
    clipIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("update-clips"),
    clips: Schema.Array(UpdateClipInputSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("update-pause"),
    clipId: Schema.String,
    pauseType: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("update-clip-text"),
    clipId: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("update-zoom"),
    clipId: Schema.String,
    zoomType: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("update-scene-override"),
    clipId: Schema.String,
    sceneOverride: Schema.NullOr(Schema.Literal(...RECORDING_SESSION_SCENES)),
  }),
  Schema.Struct({
    type: Schema.Literal("update-mic-offset"),
    clipId: Schema.String,
    micOffsetMs: Schema.Int.pipe(
      Schema.between(MIC_OFFSET_MS_RANGE.min, MIC_OFFSET_MS_RANGE.max)
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("update-mic-eq"),
    micEq: Schema.Struct({
      lowDb: MicEqGainSchema,
      midDb: MicEqGainSchema,
      highDb: MicEqGainSchema,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("reorder-clip"),
    clipId: Schema.String,
    direction: ReorderDirectionSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("create-chapter-at-insertion-point"),
    input: CreateChapterAtInsertionPointInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("create-chapter-at-position"),
    input: CreateChapterAtPositionInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("update-chapter"),
    chapterId: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("archive-chapters"),
    chapterIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("reorder-chapter"),
    chapterId: Schema.String,
    direction: ReorderDirectionSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("create-effect-clip-at-position"),
    input: CreateEffectClipAtPositionInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("create-video-from-selection"),
    input: CreateVideoFromSelectionInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("autofill-chapters"),
    input: AutofillChaptersInputSchema,
  })
);
