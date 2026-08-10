export function isVisibleInTimeline(
  snapshot: { preserved: boolean },
  pinningClips: { archived: boolean }[]
): boolean {
  return snapshot.preserved || pinningClips.some((c) => !c.archived);
}
