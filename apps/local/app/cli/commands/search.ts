import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import {
  SearchOperationsService,
  type SearchHit,
  type SearchKind,
  type SearchRoot,
} from "@/services/db-search-operations.server";
import { detail, emitNdjson, note, notFound, parseError } from "@/cli/helpers";

// ---------------------------------------------------------------------------
// Scope -> applicable result kinds
//
// A search can only surface the root and its descendants. Kinds ABOVE the root
// (or off-tree, like pitch under a course) are meaningless and are rejected
// with exit 3 rather than silently returning nothing.
// ---------------------------------------------------------------------------

type Scope = "top" | "course" | "section" | "lesson";

const APPLICABLE: Record<Scope, ReadonlyArray<SearchKind>> = {
  top: ["course", "section", "lesson", "video", "beat", "pitch"],
  course: ["course", "section", "lesson", "video", "beat"],
  section: ["section", "lesson", "video", "beat"],
  lesson: ["lesson", "video", "beat"],
};

// The top scope permits every kind, so it is the canonical kind list — derive
// the validity set from it rather than maintaining a second copy.
const ALL_KINDS = new Set<SearchKind>(APPLICABLE.top);

const isKind = (t: string): t is SearchKind => ALL_KINDS.has(t as SearchKind);

// ---------------------------------------------------------------------------
// Result trimming: drop redundant id fields, cap the result count
// ---------------------------------------------------------------------------

/** How a scope's own root id shows up on a hit, when it does. */
const SCOPE_ID_FIELD: Partial<Record<Scope, string>> = {
  course: "courseId",
  section: "sectionId",
  lesson: "lessonId",
};

/**
 * Drop parent-id fields that duplicate information the caller already has:
 * - A `course`-kind hit's `courseId` always equals its own `id` (a course IS
 *   its own course) — true regardless of scope.
 * - Every hit from a SCOPED search shares the scope root's id by
 *   construction (a `section`-scoped search only ever returns hits inside
 *   that one section's subtree, etc), so whichever field carries that id is
 *   just an echo of the id already typed on the command line.
 */
const dedupeHit = (
  hit: SearchHit,
  scope: Scope,
  rootId: string
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...hit };
  if (out.kind === "course" && out.courseId === out.id) {
    delete out.courseId;
  }
  const scopeField = SCOPE_ID_FIELD[scope];
  if (scopeField !== undefined && out[scopeField] === rootId) {
    delete out[scopeField];
  }
  return out;
};

const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Shared handler
// ---------------------------------------------------------------------------

const runSearch = (
  scope: Scope,
  rootId: string,
  query: string,
  typeInputs: ReadonlyArray<string>,
  limit: number
) =>
  Effect.gen(function* () {
    const q = query.trim();
    if (q.length === 0) {
      return yield* parseError("search query must be non-empty", "search");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return yield* parseError(
        `--limit must be a positive integer (got "${limit}")`,
        "search"
      );
    }

    const applicable = APPLICABLE[scope];
    const applicableSet = new Set<SearchKind>(applicable);
    for (const t of typeInputs) {
      if (!isKind(t)) {
        return yield* parseError(
          `unknown --type "${t}" (valid here: ${applicable.join(", ")})`,
          "search"
        );
      }
      if (!applicableSet.has(t)) {
        return yield* parseError(
          `${t} is not searchable within a ${scope} (searchable: ${applicable.join(", ")})`,
          "search"
        );
      }
    }

    const types: ReadonlySet<SearchKind> =
      typeInputs.length > 0
        ? new Set(typeInputs as SearchKind[])
        : applicableSet;

    const root: SearchRoot =
      scope === "top" ? null : { kind: scope, id: rootId };

    const svc = yield* SearchOperationsService;
    const hits = yield* svc.search({ root, query: q, types });

    // A scoped root that is missing or archived -> not-found (exit 2).
    if (hits === null) {
      return yield* notFound(scope, rootId);
    }

    const deduped = hits.map((h) => dedupeHit(h, scope, rootId));
    const shown = deduped.slice(0, limit);
    yield* emitNdjson(shown);
    if (deduped.length > shown.length) {
      yield* note(
        `search: showing ${shown.length} of ${deduped.length} matches — ` +
          `raise --limit or narrow --type/the query for the rest`
      );
    }
  });

// ---------------------------------------------------------------------------
// Option / arg definitions
// ---------------------------------------------------------------------------

const query = Args.text({ name: "query" });
const scopeId = Args.text({ name: "id" });
const typeOpt = Options.text("type").pipe(Options.repeated);
const limitOpt = Options.integer("limit").pipe(
  Options.withDefault(DEFAULT_LIMIT),
  Options.withDescription(
    `Cap the number of hits printed (default ${DEFAULT_LIMIT}). Search is ` +
      "unbounded internally, so a broad query can otherwise return an " +
      "arbitrarily large NDJSON stream; a truncation note (with the true " +
      "total) is printed to stderr when the cap is hit."
  )
);

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const TOP_HELP = `Search DOWN THE TREE for a case-insensitive, literal substring, across EVERY
active course's Draft Version PLUS all pitches. Matching is a plain substring
(no tokenising, regex or fuzzy); '%' and '_' in the query are literal.

WHAT IS SEARCHED (archived records are never returned; Draft Version only)
  course    name, slug
  section   path, description
  lesson    path, title, description
  video     title, its BODY (the shipped article), and its TRANSCRIPT
            (clip text + chapter names)
  beat      title, description
  pitch     title, description, contentPlan, youtubeTitle,
            youtubeThumbnailDescription, newsletterTitle, tweet

RESULTS (NDJSON — one compact hit per line; empty result prints nothing, exit 0)
  Each hit is self-describing: { kind, id, <identity>, <parent ids>, courseId,
  field, snippet }. 'field' is the matched field (for a video, title beats body,
  body beats transcript); 'snippet' is an excerpt around the match (the whole
  value for short fields). One hit per entity. Hits stream in depth-first tree
  order (course -> sections -> lessons -> videos -> beats), courses in
  'course list' order,
  pitches last. Use 'cvm <noun> get <id>' for the full record.

  Parent-id fields that would just echo an id you already know are omitted: a
  'course' hit never repeats its own id as courseId, and NONE of this
  command's hits repeat --limit/scope information you didn't pass here
  (top-level 'search' has no scope to omit, so parent ids are kept in full).

--type (repeatable) narrows result kinds; default is every kind above.
--limit caps the printed hit count (default ${DEFAULT_LIMIT}); a truncation
  note with the true total goes to stderr, exit code stays 0.

EXAMPLES
  cvm search "infer keyword"
  cvm search --type video --type beat "generics"
  cvm search --limit 200 "infer keyword"
  cvm search "typescript" | jq 'select(.kind == "pitch")'`;

const scopedHelp = (noun: Scope, kinds: ReadonlyArray<SearchKind>) =>
  `Search DOWN THE TREE from a single ${noun} (by id) for a case-insensitive,
literal substring. Same matching and hit shape as 'cvm search', but confined to
this ${noun}'s subtree — searchable kinds here: ${kinds.join(", ")}. A --type
outside that set is rejected (exit 3). Archived records are never returned.

Every hit here is inside the ${noun} you passed, so whichever field would
just echo that id back (e.g. ${SCOPE_ID_FIELD[noun]} on a matching child) is
omitted — you already have it.

An unknown or archived ${noun} id exits 2. Empty query exits 3. No matches
prints nothing (exit 0).

--limit caps the printed hit count (default ${DEFAULT_LIMIT}); a truncation
  note with the true total goes to stderr, exit code stays 0.

EXAMPLES
  cvm ${noun} search <${noun}Id> "generics"
  cvm ${noun} search --type video <${noun}Id> "closures"
  cvm ${noun} search --limit 200 <${noun}Id> "closures"`;

// ---------------------------------------------------------------------------
// Commands: one top-level, three scoped (reused by the noun commands)
// ---------------------------------------------------------------------------

export const searchCommand = Command.make(
  "search",
  { query, type: typeOpt, limit: limitOpt },
  ({ query, type, limit }) => runSearch("top", "", query, type, limit)
).pipe(Command.withDescription(detail(TOP_HELP)));

/**
 * The three scoped `search` verbs (`cvm course|section|lesson search`) differ
 * only by their scope literal — same args, same handler, same help shape — so
 * one factory builds all three. Each is re-exported under the name the owning
 * noun command imports.
 */
const makeScopedSearchCmd = (scope: "course" | "section" | "lesson") =>
  Command.make(
    "search",
    { id: scopeId, query, type: typeOpt, limit: limitOpt },
    ({ id, query, type, limit }) => runSearch(scope, id, query, type, limit)
  ).pipe(Command.withDescription(detail(scopedHelp(scope, APPLICABLE[scope]))));

export const courseSearchCmd = makeScopedSearchCmd("course");
export const sectionSearchCmd = makeScopedSearchCmd("section");
export const lessonSearchCmd = makeScopedSearchCmd("lesson");
