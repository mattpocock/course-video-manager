export const getBeatsSection = (beats: string): string => {
  if (!beats.trim()) return "";

  return `\n\n## Beat Plan\n\nThe following is the video's beat plan — the sketch written before the camera rolled. Each beat has a kind (Definition, Walkthrough, Playthrough, Quest, Reaction) and may have a description. It is the lowest rung of the ladder and it is stale: use it only to read the video's intended emphasis, which moves were considered load-bearing. It is not a source of content, scope or ordering, and a beat not reflected in the transcript was cut from the video:\n\n<beats>\n${beats}\n</beats>`;
};
