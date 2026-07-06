/**
 * Pure drop-resolution for Beat drag-and-drop.
 *
 * Beats live in per-Video sortable lists inside one DndContext, so a drag
 * can land on another Beat (reorder / cross-video move) or on a Video's
 * drop zone (append to that Video). This module turns a dnd-kit
 * (activeId, overId) pair into the move intent — target Video + the Beat to
 * drop before (`null` = append) — independent of React.
 */

export const BEAT_CONTAINER_PREFIX = "beat-container:";

export function beatContainerId(videoId: string): string {
  return `${BEAT_CONTAINER_PREFIX}${videoId}`;
}

export type BeatDndVideo = {
  id: string;
  beats: { id: string }[];
};

export type BeatDrop = {
  beatId: string;
  targetVideoId: string;
  /** Place the moved Beat before this one; `null` appends to the end. */
  beforeBeatId: string | null;
};

/**
 * Resolve a drag to a concrete move, or `null` when it's a no-op (dropped on
 * itself, or in the same position it already occupies).
 *
 * Rule: dropping onto a Beat inserts *before* that Beat; dropping onto a
 * Video's container appends to that Video's end.
 */
export function computeBeatDrop({
  activeId,
  overId,
  videos,
}: {
  activeId: string;
  overId: string | null;
  videos: BeatDndVideo[];
}): BeatDrop | null {
  if (!overId || overId === activeId) return null;

  const videoOfBeat = new Map<string, string>();
  for (const video of videos) {
    for (const beat of video.beats) {
      videoOfBeat.set(beat.id, video.id);
    }
  }

  const sourceVideoId = videoOfBeat.get(activeId);
  if (!sourceVideoId) return null;

  let targetVideoId: string;
  let beforeBeatId: string | null;

  if (overId.startsWith(BEAT_CONTAINER_PREFIX)) {
    targetVideoId = overId.slice(BEAT_CONTAINER_PREFIX.length);
    beforeBeatId = null;
  } else {
    const overVideoId = videoOfBeat.get(overId);
    if (!overVideoId) return null;
    targetVideoId = overVideoId;
    beforeBeatId = overId;
  }

  const targetVideo = videos.find((v) => v.id === targetVideoId);
  if (!targetVideo) return null;

  // Order of the target as it would look without the dragged beat.
  const remaining = targetVideo.beats
    .map((s) => s.id)
    .filter((id) => id !== activeId);

  const targetIndex =
    beforeBeatId === null ? remaining.length : remaining.indexOf(beforeBeatId);

  // No-op: the beat already sits exactly where it would land.
  if (sourceVideoId === targetVideoId) {
    const currentIndex = targetVideo.beats.map((s) => s.id).indexOf(activeId);
    if (currentIndex === targetIndex) return null;
  }

  return { beatId: activeId, targetVideoId, beforeBeatId };
}
