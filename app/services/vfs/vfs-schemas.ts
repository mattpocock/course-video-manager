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
});
export type LessonLeaf = z.infer<typeof LessonLeafSchema>;

export const VideoLeafSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalFootagePath: z.string(),
  warnings: z.array(z.object({ kind: z.string() })),
});
export type VideoLeaf = z.infer<typeof VideoLeafSchema>;

export const BeatLeafSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  description: z.string(),
});
export type BeatLeaf = z.infer<typeof BeatLeafSchema>;

export const ClipLeafSchema = z.object({
  type: z.literal("clip"),
  id: z.string(),
  text: z.string(),
  sourceStartTime: z.number(),
  sourceEndTime: z.number(),
  videoFilename: z.string(),
  pauseType: z.string(),
  scene: z.string().nullable(),
  profile: z.string().nullable(),
});
export type ClipLeaf = z.infer<typeof ClipLeafSchema>;

export const ChapterLeafSchema = z.object({
  type: z.literal("chapter"),
  id: z.string(),
  name: z.string(),
});
export type ChapterLeaf = z.infer<typeof ChapterLeafSchema>;

export const SectionMemberSchema = z.object({
  id: z.string(),
  slug: z.string(),
});
export type SectionMember = z.infer<typeof SectionMemberSchema>;

export const LessonMemberSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
});
export type LessonMember = z.infer<typeof LessonMemberSchema>;

export const VideoMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type VideoMember = z.infer<typeof VideoMemberSchema>;

export const BeatMemberSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
});
export type BeatMember = z.infer<typeof BeatMemberSchema>;

export const TimelineMemberSchema = z.object({
  id: z.string(),
  type: z.enum(["clip", "chapter"]),
  label: z.string(),
});
export type TimelineMember = z.infer<typeof TimelineMemberSchema>;

export type MembersLeaf =
  | SectionMember[]
  | LessonMember[]
  | VideoMember[]
  | BeatMember[]
  | TimelineMember[];
