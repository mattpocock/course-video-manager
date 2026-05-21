import { clips, chapters } from "@/db/schema";
import { compareOrderStrings } from "@/lib/sort-by-order";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { DBFunctionsService } from "./db-service.server";
import { DrizzleService } from "./drizzle-service.server";
import { UnknownDBServiceError } from "./db-service-errors";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Creates a new standalone video by concatenating clips from multiple source videos.
 *
 * For each source video, all non-archived clips and chapters are copied in order.
 * Boundary chapters are inserted between each source video, named after the source.
 * The resulting video is a normal standalone video (null lessonId).
 */
export const concatenateVideos = Effect.fn("concatenateVideos")(
  function* (opts: { name: string; sourceVideoIds: string[] }) {
    const { name, sourceVideoIds } = opts;
    const db = yield* DrizzleService;
    const dbFunctions = yield* DBFunctionsService;

    // Create the new standalone video
    const newVideo = yield* dbFunctions.createStandaloneVideo({ path: name });

    // Track the running order position across all sources
    let prevOrder: string | null = null;

    for (let i = 0; i < sourceVideoIds.length; i++) {
      const sourceVideoId = sourceVideoIds[i]!;

      // Load source video with clips and sections
      const sourceVideo =
        yield* dbFunctions.getVideoWithClipsById(sourceVideoId);

      // Insert boundary chapter between sources (not before the first)
      if (i > 0) {
        const [boundaryOrder] = generateNKeysBetween(prevOrder, null, 1);
        prevOrder = boundaryOrder!;

        yield* makeDbCall(() =>
          db.insert(chapters).values({
            videoId: newVideo.id,
            name: sourceVideo.path,
            order: prevOrder!,
            archived: false,
          })
        );
      }

      // Get all non-archived clips and chapters, sorted together
      const sourceClips = sourceVideo.clips; // already sorted by order, non-archived
      const sourceChapters = sourceVideo.chapters; // already sorted by order, non-archived

      const allItems = [
        ...sourceClips.map((c: any) => ({
          type: "clip" as const,
          item: c,
          order: c.order,
        })),
        ...sourceChapters.map((s: any) => ({
          type: "chapter" as const,
          item: s,
          order: s.order,
        })),
      ].sort((a, b) => compareOrderStrings(a.order, b.order));

      // Generate new orders for all items in this source
      if (allItems.length > 0) {
        const newOrders = generateNKeysBetween(
          prevOrder,
          null,
          allItems.length
        );

        for (let j = 0; j < allItems.length; j++) {
          const entry = allItems[j]!;
          const newOrder = newOrders[j]!;

          if (entry.type === "clip") {
            const clip = entry.item;
            yield* makeDbCall(() =>
              db.insert(clips).values({
                videoId: newVideo.id,
                videoFilename: clip.videoFilename,
                sourceStartTime: clip.sourceStartTime,
                sourceEndTime: clip.sourceEndTime,
                order: newOrder,
                archived: false,
                text: clip.text,
                transcribedAt: clip.transcribedAt,
                scene: clip.scene,
                profile: clip.profile,
                beatType: clip.beatType,
              })
            );
          } else {
            const section = entry.item;
            yield* makeDbCall(() =>
              db.insert(chapters).values({
                videoId: newVideo.id,
                name: section.name,
                order: newOrder,
                archived: false,
              })
            );
          }
        }

        prevOrder = newOrders[newOrders.length - 1]!;
      }
    }

    return newVideo;
  }
);
