export interface TreeLine {
  label: string;
  level: number;
  isVideo: boolean;
}

export function buildQueueTreeLines(
  contextParts: string[] | undefined,
  videoTitle: string
): TreeLine[] {
  const parts = contextParts ?? [];
  const lines: TreeLine[] = parts.map((label, i) => ({
    label,
    level: i,
    isVideo: false,
  }));
  lines.push({ label: videoTitle, level: parts.length, isVideo: true });
  return lines;
}
