import { Link } from "react-router";
import type { PostingQueueRow } from "@/services/db-posting-queue-operations.server";
import type { PostingQueueEntryState } from "@cvm/core/features/posting-queue/slot-schedule";
import { ListOrdered } from "lucide-react";

/** The Posting Queue as `cvm short queue` prints it (`postingQueueView`). */
export interface PostingQueuePanelData {
  days: number;
  entries: ReadonlyArray<PostingQueueRow & { goesOutAt: string | null }>;
}

const STATE_LABEL: Record<PostingQueueEntryState, string> = {
  queued: "Queued",
  posting: "Posting",
  held: "Held: check before retrying",
  posted: "Posted",
  failed: "Failed",
  removed: "Removed",
};

/**
 * The Shorts page's Queue panel (#2617): read-only, the same rows in the same
 * order as `cvm short queue`, each with when it goes out in UK time.
 */
export function PostingQueuePanel({ queue }: { queue: PostingQueuePanelData }) {
  return (
    <section className="mb-6 rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ListOrdered className="w-4 h-4" />
        Posting Queue
        <span className="font-normal text-muted-foreground">
          {queue.days === 1 ? "1 day" : `${queue.days} days`} of Shorts
        </span>
      </h2>
      {queue.entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing queued. Add a Short from its menu, or with `cvm short post`.
        </p>
      ) : (
        <ol className="mt-3 space-y-1 text-xs">
          {queue.entries.map((entry, index) => (
            <li
              key={entry.entryId}
              className="grid grid-cols-[2rem_1fr_auto_10rem] items-baseline gap-2"
            >
              <span className="text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                <Link
                  to={`/videos/${entry.videoId}/edit`}
                  className="font-medium hover:underline"
                >
                  {entry.title}
                </Link>
                {entry.lastFailureReason &&
                  (entry.state === "failed" || entry.state === "held") && (
                    <span className="block text-destructive">
                      {entry.lastFailureReason}
                    </span>
                  )}
              </span>
              <span
                className={
                  entry.state === "failed" || entry.state === "held"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              >
                {STATE_LABEL[entry.state]}
              </span>
              <span className="text-right tabular-nums">
                {entry.goesOutAt ?? "-"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
