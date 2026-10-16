import type { ShortScene } from "@/services/short-clip-mockup-frame";

/**
 * THE ORDER OF A SHORT'S ANIMATIC: its first Clip Mockup is the Camera
 * moment, Matt to camera, and every one after it is a Code moment.
 *
 * The scene is not stored on the row. It does not need to be: every write to
 * a Short's Clip Mockups goes through these checks, so a Clip Mockup's scene
 * is its position — the first is Camera, the rest are Code — and the frame CVM
 * composed for it already shows it. Each check says what the write would do
 * to that order, and a write that would break it is refused with the reason,
 * before anything is captured or written.
 *
 * Pure, so each rule is one line of reasoning: the `add`, `update`, `move`
 * and `delete` verbs read the rows and call these.
 */

/** The scene the Clip Mockup at this 1-based position of a Short must be. */
export const shortSceneAt = (position: number): ShortScene =>
  position === 1 ? "camera" : "code";

const SHORT_ORDER =
  "a Short's Animatic opens with ONE Camera moment, and every Clip Mockup after it is Code";

/**
 * `add`: the moments of the file, in file order, appended after the Short's
 * `existing` Clip Mockups. Each must name the scene its new position needs.
 */
export const shortAddProblem = (
  existing: number,
  moments: ReadonlyArray<{
    readonly entry: number;
    readonly scene: ShortScene | undefined;
  }>
): string | undefined => {
  for (const [i, moment] of moments.entries()) {
    const position = existing + i + 1;
    const needed = shortSceneAt(position);
    if (moment.scene === undefined) {
      return `entry ${moment.entry} needs "scene" on a Short: "${needed}" here (${SHORT_ORDER})`;
    }
    if (moment.scene !== needed) {
      return needed === "camera"
        ? `entry ${moment.entry} would be Clip Mockup 1 of this Short, so it must be "scene": "camera" (${SHORT_ORDER})`
        : `entry ${moment.entry} would be Clip Mockup ${position} of this Short, so it must be "scene": "code" — the Short already opens with its Camera moment (${SHORT_ORDER})`;
    }
  }
  return undefined;
};

/** `add` on a Landscape Video: the scenes are a Short's. */
export const landscapeAddProblem = (
  moments: ReadonlyArray<{
    readonly entry: number;
    readonly scene: ShortScene | undefined;
  }>
): string | undefined => {
  const scened = moments.find((m) => m.scene !== undefined);
  return scened === undefined
    ? undefined
    : `entry ${scened.entry} has "scene", which is for a Short's Clip Mockups only; this Video is Landscape`;
};

/**
 * `update`: a new picture for the Clip Mockup at this position. The Camera
 * moment has no picture of its own to change: CVM draws it.
 */
export const shortUpdateProblem = (
  entry: number,
  position: number
): string | undefined =>
  shortSceneAt(position) === "camera"
    ? `entry ${entry} gives a picture to Clip Mockup 1 of a Short, its Camera moment, which CVM draws — change its "say" only (${SHORT_ORDER})`
    : undefined;

/**
 * `move`: the Animatic as it is (Clip Mockups and Chapters, in order), the
 * row being moved, and the row it will go before (`null`: the end). Refused
 * when a different Clip Mockup would open the Short.
 */
export const shortMoveProblem = (
  items: ReadonlyArray<{ readonly type: string; readonly id: string }>,
  movedId: string,
  beforeId: string | null
): string | undefined => {
  const firstMockup = (rows: ReadonlyArray<{ type: string; id: string }>) =>
    rows.find((r) => r.type === "clipMockup")?.id;

  const moved = items.find((r) => r.id === movedId);
  if (moved === undefined) return undefined;
  const rest = items.filter((r) => r.id !== movedId);
  const at = beforeId === null ? -1 : rest.findIndex((r) => r.id === beforeId);
  const after =
    at === -1
      ? [...rest, moved]
      : [...rest.slice(0, at), moved, ...rest.slice(at)];

  if (firstMockup(after) === firstMockup(items)) return undefined;
  return firstMockup(items) === movedId
    ? `Clip Mockup ${movedId} is this Short's Camera moment, so it stays first (${SHORT_ORDER})`
    : `moving Clip Mockup ${movedId} there would put a Code moment before this Short's Camera moment (${SHORT_ORDER})`;
};

/**
 * `delete`: the Short's Clip Mockups in order, and the one going. The Camera
 * moment goes last, or the next Code moment would open the Short.
 */
export const shortDeleteProblem = (
  mockupIds: ReadonlyArray<string>,
  deletedId: string
): string | undefined =>
  mockupIds[0] === deletedId && mockupIds.length > 1
    ? `Clip Mockup ${deletedId} is this Short's Camera moment; deleting it would leave a Code moment first. Change its "say" with 'update', or delete the ${mockupIds.length - 1} after it first (${SHORT_ORDER})`
    : undefined;
