import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import type { VideoFormat } from "@/features/videos/video-format";
import {
  videoMenuGroups,
  type VideoMenuActions,
} from "@/features/video-menu/video-menu";

type LeftOut = Partial<Record<keyof VideoMenuActions, string>>;

/**
 * The landscape editor's actions a Short's Actions menu leaves out, each with
 * why it cannot apply to a Short. Everything else the landscape editor offers,
 * the Short's menu offers too (`editor-menu.test.ts` holds it to that).
 */
export const SHORT_LEAVES_OUT = {
  newShort: "it makes a Short from a Video; this Video is the Short",
  reference:
    "the Reference candidates are the other Videos of the same Lesson, and a Short belongs to no Lesson",
  editLessonBody: "edits the Lesson's body, and a Short belongs to no Lesson",
  autofillDescription:
    "fills the Lesson's SEO description from its body, and a Short belongs to no Lesson",
  addVideoToLesson:
    "adds a Video to the Lesson, and a Short belongs to no Lesson",
  createConcatenatedVideo:
    "the concatenate page lists and makes Landscape Videos only",
} as const satisfies LeftOut;

/**
 * The Short's actions the landscape editor leaves out. Silence Length stays a
 * toggle under the landscape player; posting is the Short's.
 */
export const LANDSCAPE_LEAVES_OUT = {
  silenceLength: "the landscape editor keeps its toggle under the player",
  postShort: "posting is a Short's",
  postToYouTube: "posting is a Short's",
  postToTikTok: "posting is a Short's",
} as const satisfies LeftOut;

/**
 * The one Actions menu both video editors render — the landscape editor and
 * the Short's portrait studio — from one set of actions. Only the format
 * decides what is left out, so the two menus cannot drift apart.
 */
export function editorVideoMenuGroups(
  format: VideoFormat,
  actions: VideoMenuActions
): ActionMenuGroups {
  const leftOut: LeftOut =
    format === "short" ? SHORT_LEAVES_OUT : LANDSCAPE_LEAVES_OUT;
  const offered: VideoMenuActions = { ...actions };
  for (const key of Object.keys(leftOut) as (keyof VideoMenuActions)[]) {
    delete offered[key];
  }
  return videoMenuGroups(offered, { groupRareActions: true });
}
