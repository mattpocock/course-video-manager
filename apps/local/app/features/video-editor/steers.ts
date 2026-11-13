/**
 * The **Steers** given in one Video Editor: an ordered list, oldest first, of
 * short instructions the author gave to guide the next Suggestion, each tied
 * to where it was given (#2708). Pure; the Suggestions reducer holds the list.
 *
 * A Steer belongs to the Insertion Point's **anchor**: the item (Clip or
 * Chapter) just before it, `null` at the start of the Video.
 *
 *   - The Steer in effect is the newest one at the current anchor that is not
 *     used up. Giving a Steer where one is in effect edits it; clearing
 *     removes it.
 *   - A Clip recorded after the Steer was given, whose transcript arrives with
 *     the Steer's anchor just before it, uses the Steer up.
 *   - A used-up Steer whose Clip has left the timeline (deleted, archived)
 *     counts as not used up, so it is back in effect at its anchor. That is
 *     derived from the timeline, never stored.
 */

/** One Steer: what the author asked for, where, and what used it up. */
export type Steer = {
  id: number;
  /** The item just before the Insertion Point it was given at. */
  anchor: string | null;
  text: string;
  /** The Clips on the timeline when it was given: none of them uses it up. */
  clipsWhenGiven: string[];
  /** The Clip that used it up; it only counts while that Clip is on the timeline. */
  usedBy: string | null;
};

/** Every Clip on the timeline, with the item just before it. */
export type PreviousItems = Record<string, string | null>;

const isUsedUp = (steer: Steer, previousItems: PreviousItems) =>
  steer.usedBy !== null && steer.usedBy in previousItems;

/** The newest Steer at `anchor` that is not used up. */
export const findSteerInEffect = (
  steers: Steer[],
  anchor: string | null,
  previousItems: PreviousItems
): Steer | undefined =>
  steers.findLast(
    (steer) => steer.anchor === anchor && !isUsedUp(steer, previousItems)
  );

/** Give a Steer at `anchor`, or edit the one in effect there. */
export const giveSteer = (
  steers: Steer[],
  input: {
    id: number;
    anchor: string | null;
    text: string;
    previousItems: PreviousItems;
  }
): Steer[] => {
  const inEffect = findSteerInEffect(steers, input.anchor, input.previousItems);
  if (inEffect) {
    return steers.map((steer) =>
      steer.id === inEffect.id ? { ...steer, text: input.text } : steer
    );
  }
  return [
    ...steers,
    {
      id: input.id,
      anchor: input.anchor,
      text: input.text,
      clipsWhenGiven: Object.keys(input.previousItems),
      usedBy: null,
    },
  ];
};

/** Remove the Steer in effect at `anchor`, if there is one. */
export const clearSteer = (
  steers: Steer[],
  anchor: string | null,
  previousItems: PreviousItems
): Steer[] => {
  const inEffect = findSteerInEffect(steers, anchor, previousItems);
  return inEffect ? steers.filter((steer) => steer.id !== inEffect.id) : steers;
};

/**
 * Each Clip just accepted (its transcript arrived) uses up the Steer in effect
 * at the item before it, unless the Clip was already on the timeline when the
 * Steer was given. Returns `steers` itself when nothing is used up.
 */
export const markSteersUsedUp = (
  steers: Steer[],
  accepted: string[],
  previousItems: PreviousItems
): Steer[] => {
  let next = steers;
  for (const clipId of accepted) {
    if (!(clipId in previousItems)) continue;
    const anchor = previousItems[clipId];
    const steer = next.findLast(
      (s) =>
        s.anchor === anchor &&
        !isUsedUp(s, previousItems) &&
        !s.clipsWhenGiven.includes(clipId)
    );
    if (!steer) continue;
    next = next.map((s) => (s.id === steer.id ? { ...s, usedBy: clipId } : s));
  }
  return next;
};
