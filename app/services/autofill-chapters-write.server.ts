import { chapters, clips, videos } from "@/db/schema";
import type { Database } from "@/services/drizzle-service.server";
import { eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";

/** A Chapter the model proposed: a title, and the **Clip** it opens on. */
export type ProposedChapter = {
  readonly beforeClipId: string;
  readonly title: string;
};

export type WrittenChapter = typeof chapters.$inferSelect & {
  beforeClipId: string;
};

/**
 * THE chapter write behind **Autofill chapters**, shared by the per-Video
 * action (through the clip service) and the batch **Autofill**, so the two can
 * never disagree about what "replace the Chapters" means.
 *
 * A whole-set replacement: every existing Chapter on the Video is archived and
 * the proposals are inserted in timeline order, each positioned immediately
 * before the Clip it names. Proposals naming a Clip this Video does not have —
 * or naming one twice — are dropped: an id the model invented must never reach
 * the timeline.
 *
 * Takes a `Database` rather than reaching for one, so a caller can hand it a
 * transaction handle and commit this alongside its own writes.
 */
export const replaceVideoChapters = async (
  db: Database,
  input: { videoId: string; proposals: readonly ProposedChapter[] }
): Promise<WrittenChapter[]> => {
  const { videoId } = input;

  const orderedClips = await db.query.clips.findMany({
    where: eq(clips.videoId, videoId),
    orderBy: (table, { asc }) => asc(table.order),
  });

  const activeClips = orderedClips.filter((c) => !c.archived);
  const clipIndexById = new Map(activeClips.map((c, i) => [c.id, i]));

  const seen = new Set<string>();
  const validated = input.proposals
    .filter((proposal) => {
      if (seen.has(proposal.beforeClipId)) return false;
      if (!clipIndexById.has(proposal.beforeClipId)) return false;
      seen.add(proposal.beforeClipId);
      return true;
    })
    .map((proposal) => ({
      ...proposal,
      clipIndex: clipIndexById.get(proposal.beforeClipId)!,
    }))
    .sort((a, b) => a.clipIndex - b.clipIndex);

  await db
    .update(chapters)
    .set({ archived: true })
    .where(eq(chapters.videoId, videoId));

  const written: WrittenChapter[] = [];
  for (const proposal of validated) {
    const targetClip = activeClips[proposal.clipIndex]!;
    const prevClip = activeClips[proposal.clipIndex - 1];
    const [order] = generateNKeysBetween(
      prevClip?.order ?? null,
      targetClip.order,
      1
    );

    const [row] = await db
      .insert(chapters)
      .values({ videoId, name: proposal.title, order: order!, archived: false })
      .returning();

    if (!row) throw new Error("Failed to insert Chapter");
    written.push({ ...row, beforeClipId: proposal.beforeClipId });
  }

  await db
    .update(videos)
    .set({ updatedAt: new Date() })
    .where(eq(videos.id, videoId));

  return written;
};
