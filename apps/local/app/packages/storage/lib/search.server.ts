import path from "node:path";
import { Effect } from "effect";
import { matchesSearchQuery } from "@cvm/core/lib/search-match";
import { readFootageTranscript } from "@/services/footage-cache";
import { asFootageImportError, findImportedFootage } from "./import.server";
import type { StorageRoots } from "./storage-roots";

/** One transcript segment of Imported Footage that matched a query. */
export interface ImportedFootageHit {
  /** Root-relative, as a Clip stores it. */
  readonly path: string;
  /** The segment's start and end, in seconds on the file's own timeline. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ImportedFootageSearchResult {
  /** In path, then time, order. */
  readonly hits: readonly ImportedFootageHit[];
  /** Root-relative paths with no fresh transcript: never searched. */
  readonly notTranscribed: readonly string[];
}

/**
 * THE search over what was said in Imported Footage, shared by `cvm footage
 * search` and the Imported Footage page. It walks `raw-footage/imported/` on
 * every Storage Root and reads each file's transcript sidecar only if it is
 * FRESH (its content hash still matches the bytes): a stale or missing one
 * puts the file in `notTranscribed`, never matched against old words. Each
 * transcript SEGMENT's text is matched with `matchesSearchQuery` (literal,
 * case-insensitive). A blank query matches nothing.
 */
export const searchImportedFootage = (roots: StorageRoots, query: string) =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => findImportedFootage(roots),
      catch: asFootageImportError,
    });
    const hits: ImportedFootageHit[] = [];
    const notTranscribed: string[] = [];
    for (const file of files) {
      const transcript = yield* readFootageTranscript(
        path.join(file.location, file.path)
      );
      if (transcript === null) {
        notTranscribed.push(file.path);
        continue;
      }
      if (query.trim() === "") continue;
      const matched = transcript.segments
        .filter((segment) => matchesSearchQuery(segment.text, query))
        .sort((a, b) => a.start - b.start);
      for (const { start, end, text } of matched) {
        hits.push({ path: file.path, start, end, text: text.trim() });
      }
    }
    return { hits, notTranscribed } satisfies ImportedFootageSearchResult;
  });
