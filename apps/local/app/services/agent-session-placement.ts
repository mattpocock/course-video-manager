import { isScreenClip } from "@cvm/core/features/agent-sessions/anchor-entries";
import {
  clipExportDurationInSeconds,
  paddedClipDurationsInSeconds,
  type SourceClipDuration,
} from "./export-duration-check";

/**
 * Where an Agent Session Entry shows in a Video's CURRENT cut: its
 * `visibleFrom`, seconds into the exported Video. THE ONE place that turns a
 * stored entry (a Clip and a Footage time) into video time, so `cvm video
 * agent-sessions get` and course.json can never disagree.
 *
 * - On its Clip: where the Clip starts in the Video, plus how far past the
 *   Clip's in-point the entry was written — `max(0, footageTime − in-point)`,
 *   so an entry written before the in-point (in Footage that was cut) shows
 *   from the Clip's start.
 * - Past its Clip's out-point (the end was trimmed), or on a Clip no longer
 *   showing the screen: from the start of the next screen Clip in the Video;
 *   with none after it, not at all.
 * - On a Clip not in the cut (archived): not at all.
 *
 * A Clip starts where the export puts it: after every earlier Clip's length,
 * each long Pause included, in whole frames on a Video rendered Clip by Clip
 * (`paddedClipDurationsInSeconds`).
 */

/** A live Clip of the Video, in video order. */
export type PlacementClip = SourceClipDuration & {
  readonly id: string;
  readonly scene: string | null;
  readonly sceneOverride: string | null;
};

/** Video time to the millisecond: the precision course.json carries. */
const toMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** `visibleFrom` for each entry, in the order given; null when it never shows. */
export const placeAgentSessionEntries = <
  T extends { readonly clipId: string; readonly footageTime: number },
>(
  clipsInVideoOrder: ReadonlyArray<PlacementClip>,
  entries: ReadonlyArray<T>
): Array<{ readonly entry: T; readonly visibleFrom: number | null }> => {
  const durations = paddedClipDurationsInSeconds(clipsInVideoOrder);
  let elapsed = 0;
  const placed = clipsInVideoOrder.map((clip, i) => {
    const start = elapsed;
    elapsed += clipExportDurationInSeconds(durations[i]!);
    return { clip, start, index: i, isScreen: isScreenClip(clip) };
  });
  const byId = new Map(placed.map((p) => [p.clip.id, p]));
  const nextScreenStart = (index: number) =>
    placed.find((p) => p.index > index && p.isScreen)?.start ?? null;

  return entries.map((entry) => {
    const at = byId.get(entry.clipId);
    if (!at) return { entry, visibleFrom: null };
    if (!at.isScreen || entry.footageTime > at.clip.sourceEndTime) {
      const next = nextScreenStart(at.index);
      return { entry, visibleFrom: next === null ? null : toMs(next) };
    }
    return {
      entry,
      visibleFrom: toMs(
        at.start + Math.max(0, entry.footageTime - at.clip.sourceStartTime)
      ),
    };
  });
};

/**
 * Entries grouped by Agent Session, for showing: only the ones that show,
 * sessions in the order they first appear in the cut, each session's entries
 * by `visibleFrom` (then by their place in the session).
 */
export const visibleAgentSessions = <
  T extends {
    readonly agentSessionId: string;
    readonly sequence: number;
    readonly clipId: string;
    readonly footageTime: number;
  },
>(
  clipsInVideoOrder: ReadonlyArray<PlacementClip>,
  entries: ReadonlyArray<T>
): Array<{
  readonly agentSessionId: string;
  readonly entries: ReadonlyArray<{
    readonly entry: T;
    readonly visibleFrom: number;
  }>;
}> => {
  const sessions = new Map<string, Array<{ entry: T; visibleFrom: number }>>();
  for (const { entry, visibleFrom } of placeAgentSessionEntries(
    clipsInVideoOrder,
    entries
  )) {
    if (visibleFrom === null) continue;
    const list = sessions.get(entry.agentSessionId) ?? [];
    list.push({ entry, visibleFrom });
    sessions.set(entry.agentSessionId, list);
  }
  return [...sessions]
    .map(([agentSessionId, list]) => ({
      agentSessionId,
      entries: list.sort(
        (a, b) =>
          a.visibleFrom - b.visibleFrom || a.entry.sequence - b.entry.sequence
      ),
    }))
    .sort((a, b) => a.entries[0]!.visibleFrom - b.entries[0]!.visibleFrom);
};
