import { z } from "zod";

export const CourseLeafSchema = z.object({
  id: z.string(),
  name: z.string(),
  memory: z.string(),
  version: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
  }),
});
export type CourseLeaf = z.infer<typeof CourseLeafSchema>;

export const SectionLeafSchema = z.object({
  id: z.string(),
  slug: z.string(),
  description: z.string(),
  order: z.number(),
  real: z.boolean(),
});
export type SectionLeaf = z.infer<typeof SectionLeafSchema>;

export const LessonLeafSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  priority: z.number(),
  dependencies: z.array(z.string()),
  authoringStatus: z.enum(["todo", "done"]).nullable(),
  fsStatus: z.enum(["real", "ghost"]),
  order: z.number(),
});
export type LessonLeaf = z.infer<typeof LessonLeafSchema>;

export const VideoLeafSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalFootagePath: z.string(),
  warnings: z.array(z.object({ kind: z.string() })),
});
export type VideoLeaf = z.infer<typeof VideoLeafSchema>;

export const SegmentItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  description: z.string(),
  order: z.number(),
});
export const SegmentsLeafSchema = z.array(SegmentItemSchema);
export type SegmentsLeaf = z.infer<typeof SegmentsLeafSchema>;

const TimelineChapterSchema = z.object({
  type: z.literal("chapter"),
  id: z.string(),
  name: z.string(),
});

const TimelineClipSchema = z.object({
  type: z.literal("clip"),
  id: z.string(),
  text: z.string(),
  sourceStartTime: z.number(),
  sourceEndTime: z.number(),
  videoFilename: z.string(),
  beatType: z.string(),
  scene: z.string().nullable(),
  profile: z.string().nullable(),
});

export const TimelineItemSchema = z.discriminatedUnion("type", [
  TimelineChapterSchema,
  TimelineClipSchema,
]);
export const TimelineLeafSchema = z.array(TimelineItemSchema);
export type TimelineLeaf = z.infer<typeof TimelineLeafSchema>;
