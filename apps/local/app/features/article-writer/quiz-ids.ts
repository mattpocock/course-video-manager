/**
 * Quiz ids across a whole course.
 *
 * An id is the key a reader's answers are stored against, so two questions
 * sharing one silently merge two questions' response history — damage that is
 * invisible on the page. Uniqueness is therefore a property of the course, not
 * of a body, and every check that can see the course lives here.
 */

import { collectQuizIds, parseQuizBlocks } from "./quiz-syntax";

/** One video's use of one quiz id. */
export interface QuizIdUse {
  id: string;
  videoId: string;
  videoTitle: string;
  lessonTitle?: string | null;
}

export interface QuizIdCollision {
  id: string;
  uses: QuizIdUse[];
}

export interface VideoBody {
  videoId: string;
  videoTitle: string;
  lessonTitle?: string | null;
  body: string | null;
}

/** Every quiz id in a course, one entry per use, in reading order. */
export function collectCourseQuizIdUses(videos: VideoBody[]): QuizIdUse[] {
  return videos.flatMap((video) =>
    collectQuizIds(video.body ?? "").map((id) => ({
      id,
      videoId: video.videoId,
      videoTitle: video.videoTitle,
      lessonTitle: video.lessonTitle,
    }))
  );
}

/**
 * Ids used more than once anywhere in the course — including twice inside one
 * body, which is the same damage by a shorter route.
 */
export function findQuizIdCollisions(uses: QuizIdUse[]): QuizIdCollision[] {
  const byId = new Map<string, QuizIdUse[]>();
  for (const use of uses) {
    const existing = byId.get(use.id);
    if (existing) existing.push(use);
    else byId.set(use.id, [use]);
  }

  return [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({ id, uses: group }));
}

/**
 * The first free id built from a taken one.
 *
 * A numeric suffix, deliberately: an id names a concept, and `-2` names
 * nothing, but it is unique on the first try. A model rename is a round trip
 * that can collide again, and the rule exists to protect response data rather
 * than to write good ids. A suffix appearing at all says two lessons test the
 * same concept — a content problem no id was going to fix.
 */
export function nextFreeQuizId(id: string, taken: Set<string>): string {
  const stem = /-(\d+)$/.exec(id) ? id.replace(/-\d+$/, "") : id;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Renames every colliding id in one document.
 *
 * `taken` holds the ids already spoken for elsewhere in the course. The first
 * use of an id in this document keeps it unless the course already has it;
 * later uses are suffixed, so a rewrite never renames a question that was fine.
 */
export function renameCollidingQuizIds(
  body: string,
  taken: Iterable<string>
): string {
  const reserved = new Set(taken);
  const edits: { start: number; end: number; id: string }[] = [];

  for (const block of parseQuizBlocks(body)) {
    for (const question of block.questions) {
      const id = question.data?.id;
      if (!id) continue;
      if (!reserved.has(id)) {
        reserved.add(id);
        continue;
      }
      const replacement = nextFreeQuizId(id, reserved);
      reserved.add(replacement);
      edits.push({ start: question.start, end: question.end, id: replacement });
    }
  }

  // Applied last-first so each splice leaves the earlier offsets valid.
  let out = body;
  for (const edit of edits.reverse()) {
    const tag = out.slice(edit.start, edit.end);
    out =
      out.slice(0, edit.start) +
      tag.replace(/(\bid\s*:\s*["'])[^"']*(["'])/, `$1${edit.id}$2`) +
      out.slice(edit.end);
  }

  return out;
}
