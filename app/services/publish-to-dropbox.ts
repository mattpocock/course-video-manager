import { Data } from "effect";

export class DoesNotExistOnDbError extends Data.TaggedError(
  "DoesNotExistOnDbError"
)<{
  type: "section" | "lesson";
  path: string;
  message: string;
}> {}

export type Chapter = {
  title: string;
  startTime: number;
};

type ChapterClip = {
  order: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

type ChapterSection = {
  order: string;
  name: string;
};

export const buildChapters = (
  clips: ChapterClip[],
  chapters: ChapterSection[]
): Chapter[] | null => {
  type Item =
    | { kind: "clip"; order: string; duration: number }
    | { kind: "section"; order: string; name: string };

  const items: Item[] = [
    ...clips.map((c): Item => ({
      kind: "clip",
      order: c.order,
      duration: c.sourceEndTime - c.sourceStartTime,
    })),
    ...chapters.map((s): Item => ({
      kind: "section",
      order: s.order,
      name: s.name,
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  let elapsed = 0;
  const raw: Chapter[] = [];
  for (const item of items) {
    if (item.kind === "clip") {
      elapsed += item.duration;
    } else {
      raw.push({ title: item.name, startTime: Math.floor(elapsed) });
    }
  }

  const totalSeconds = Math.floor(elapsed);
  const kept: Chapter[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = i + 1 < raw.length ? raw[i + 1]!.startTime : totalSeconds;
    if (raw[i]!.startTime < next) {
      kept.push(raw[i]!);
    }
  }

  if (kept.length === 0) return null;

  if (kept[0]!.startTime > 0) {
    kept.unshift({ title: "Intro", startTime: 0 });
  }

  return kept;
};
