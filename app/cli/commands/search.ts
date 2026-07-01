import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import {
  SearchOperationsService,
  type SearchKind,
  type SearchRoot,
} from "@/services/db-search-operations.server";
import { detail, emitNdjson, notFound, parseError } from "@/cli/helpers";

// ---------------------------------------------------------------------------
// Scope -> applicable result kinds
//
// A search can only surface the root and its descendants. Kinds ABOVE the root
// (or off-tree, like pitch under a course) are meaningless and are rejected
// with exit 3 rather than silently returning nothing.
// ---------------------------------------------------------------------------

type Scope = "top" | "course" | "section" | "lesson";

const APPLICABLE: Record<Scope, ReadonlyArray<SearchKind>> = {
  top: ["course", "section", "lesson", "video", "segment", "pitch"],
  course: ["course", "section", "lesson", "video", "segment"],
  section: ["section", "lesson", "video", "segment"],
  lesson: ["lesson", "video", "segment"],
};

// The top scope permits every kind, so it is the canonical kind list — derive
// the validity set from it rather than maintaining a second copy.
const ALL_KINDS = new Set<SearchKind>(APPLICABLE.top);

const isKind = (t: string): t is SearchKind => ALL_KINDS.has(t as SearchKind);

// ---------------------------------------------------------------------------
// Shared handler
// ---------------------------------------------------------------------------

const runSearch = (
  scope: Scope,
  rootId: string,
  query: string,
  typeInputs: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const q = query.trim();
    if (q.length === 0) {
      return yield* parseError("search query must be non-empty", "search");
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

    yield* emitNdjson(hits);
  });

// ---------------------------------------------------------------------------
// Option / arg definitions
// ---------------------------------------------------------------------------

const query = Args.text({ name: "query" });
const scopeId = Args.text({ name: "id" });
const typeOpt = Options.text("type").pipe(Options.repeated);

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
  video     path, and its TRANSCRIPT (clip text + chapter names)
  segment   title, description
  pitch     title, description, contentPlan, youtubeTitle,
            youtubeThumbnailDescription, newsletterTitle, tweet

RESULTS (NDJSON — one compact hit per line; empty result prints nothing, exit 0)
  Each hit is self-describing: { kind, id, <identity>, <parent ids>, courseId,
  field, snippet }. 'field' is the matched field (path beats transcript for a
  video); 'snippet' is an excerpt around the match (the whole value for short
  fields). One hit per entity. Hits stream in depth-first tree order (course ->
  sections -> lessons -> videos -> segments), courses in 'course list' order,
  pitches last. Use 'cvm <noun> get <id>' for the full record.

--type (repeatable) narrows result kinds; default is every kind above.

EXAMPLES
  cvm search "infer keyword"
  cvm search --type video --type segment "generics"
  cvm search "typescript" | jq 'select(.kind == "pitch")'`;

const scopedHelp = (noun: Scope, kinds: ReadonlyArray<SearchKind>) =>
  `Search DOWN THE TREE from a single ${noun} (by id) for a case-insensitive,
literal substring. Same matching and hit shape as 'cvm search', but confined to
this ${noun}'s subtree — searchable kinds here: ${kinds.join(", ")}. A --type
outside that set is rejected (exit 3). Archived records are never returned.

An unknown or archived ${noun} id exits 2. Empty query exits 3. No matches
prints nothing (exit 0).

EXAMPLES
  cvm ${noun} search <${noun}Id> "generics"
  cvm ${noun} search --type video <${noun}Id> "closures"`;

// ---------------------------------------------------------------------------
// Commands: one top-level, three scoped (reused by the noun commands)
// ---------------------------------------------------------------------------

export const searchCommand = Command.make(
  "search",
  { query, type: typeOpt },
  ({ query, type }) => runSearch("top", "", query, type)
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
    { id: scopeId, query, type: typeOpt },
    ({ id, query, type }) => runSearch(scope, id, query, type)
  ).pipe(Command.withDescription(detail(scopedHelp(scope, APPLICABLE[scope]))));

export const courseSearchCmd = makeScopedSearchCmd("course");
export const sectionSearchCmd = makeScopedSearchCmd("section");
export const lessonSearchCmd = makeScopedSearchCmd("lesson");
