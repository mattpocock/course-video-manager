import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { searchImportedFootage } from "@/packages/storage/import";
import { readStorageRootsSync } from "@/services/storage-roots";
import { detail, emitNdjson, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import { requireLocalFootage } from "./footage-jobs";
import { SEARCH_HELP } from "./footage.help";

/** `cvm footage search <query>`: the shared Imported Footage search, as NDJSON. */
export const searchCmd = Command.make(
  "search",
  { query: Args.text({ name: "query" }) },
  ({ query }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      if (query.trim() === "") {
        return yield* parseError("search query must be non-empty", "footage");
      }
      const roots = yield* Effect.try({
        try: () => readStorageRootsSync(),
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      }).pipe(Effect.catchAll((message) => parseError(message, "footage")));
      const { hits, notTranscribed } = yield* searchImportedFootage(
        roots,
        query
      );
      yield* emitNdjson(hits);
      if (notTranscribed.length > 0) {
        const out = yield* CliOutput;
        yield* out.stderr(JSON.stringify({ notTranscribed }) + "\n");
      }
    })
).pipe(Command.withDescription(detail(SEARCH_HELP)));
