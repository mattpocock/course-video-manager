import { BEAT_KIND_LABELS, type BeatKind } from "@/features/beats/beat-kinds";

export interface BeatContextItem {
  kind: BeatKind;
  title: string;
  description: string;
}

export function formatBeatsContext(beats: BeatContextItem[]): string {
  if (beats.length === 0) return "";

  return beats
    .map((beat, i) => {
      const label = BEAT_KIND_LABELS[beat.kind];
      const header = beat.title
        ? `${i + 1}. [${label}] ${beat.title}`
        : `${i + 1}. [${label}]`;

      if (!beat.description) return header;

      const indentedDesc = beat.description
        .split("\n")
        .map((line) => `   ${line}`)
        .join("\n");
      return `${header}\n${indentedDesc}`;
    })
    .join("\n");
}
