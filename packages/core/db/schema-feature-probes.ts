/**
 * The five Postgres features this schema leans on that a hosted Postgres
 * (PlanetScale) documents nothing about: `COLLATE "C"`, generated `tsvector`
 * `STORED` columns, GIN indexes, partial unique indexes and `text[]`. Losing
 * any of them is silent — Fractional Index ordering would start comparing
 * locale-aware, Diagram search would stop matching — so each one is probed
 * against the live database after migrations run.
 *
 * Each probe is one read-only query plus a pure verdict over its rows, which
 * is what lets the same probes run against PGlite in a test and against the
 * hosted database from `scripts/verify-schema-features.ts`.
 */
export interface ProbeVerdict {
  readonly ok: boolean;
  /** Human-readable evidence — printed by the script whether it passed or not. */
  readonly detail: string;
}

export interface SchemaFeatureProbe {
  readonly name: string;
  readonly sql: string;
  readonly check: (
    rows: ReadonlyArray<Record<string, unknown>>
  ) => ProbeVerdict;
}

const TABLE_PREFIX = "course-video-manager_";

/** Columns declared `varchar(255) COLLATE "C"` — the Fractional Index columns. */
const COLLATE_C_COLUMNS = [
  `${TABLE_PREFIX}clip.order`,
  `${TABLE_PREFIX}beat.order`,
  `${TABLE_PREFIX}chapter.order`,
];

/** Generated `tsvector` columns backing Diagram search. */
const SEARCH_VECTOR_COLUMNS = [
  `${TABLE_PREFIX}diagram.search_vector`,
  `${TABLE_PREFIX}diagram_snapshot.search_vector`,
];

const missing = (
  expected: ReadonlyArray<string>,
  found: ReadonlyArray<string>
) => expected.filter((e) => !found.includes(e));

export const SCHEMA_FEATURE_PROBES: ReadonlyArray<SchemaFeatureProbe> = [
  {
    name: 'COLLATE "C" ordering',
    // Two halves: the columns still carry the C collation, and the server
    // actually orders by it ('Z' < 'a' in C, but not in en_US).
    sql: `
      SELECT table_name || '.' || column_name AS column,
             collation_name AS collation,
             ('Z' COLLATE "C") < ('a' COLLATE "C") AS c_orders_by_codepoint
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND collation_name = 'C'
        AND column_name = 'order'
      ORDER BY 1
    `,
    check: (rows) => {
      const found = rows.map((r) => String(r.column));
      const absent = missing(COLLATE_C_COLUMNS, found);
      const ordersByCodepoint = rows.every(
        (r) => r.c_orders_by_codepoint === true
      );
      if (absent.length > 0) {
        return { ok: false, detail: `no C collation on: ${absent.join(", ")}` };
      }
      if (!ordersByCodepoint) {
        return {
          ok: false,
          detail: `columns are COLLATE "C" but 'Z' < 'a' is false — the collation is not being applied`,
        };
      }
      return {
        ok: true,
        detail: `${found.length} column(s) COLLATE "C"; 'Z' < 'a' holds`,
      };
    },
  },
  {
    name: "generated tsvector STORED columns",
    sql: `
      SELECT table_name || '.' || column_name AS column,
             udt_name AS type,
             is_generated AS generated
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'search_vector'
      ORDER BY 1
    `,
    check: (rows) => {
      const stored = rows
        .filter((r) => r.generated === "ALWAYS" && r.type === "tsvector")
        .map((r) => String(r.column));
      const absent = missing(SEARCH_VECTOR_COLUMNS, stored);
      return absent.length === 0
        ? { ok: true, detail: `generated ALWAYS: ${stored.join(", ")}` }
        : {
            ok: false,
            detail: `not stored-generated tsvector: ${absent.join(", ")}`,
          };
    },
  },
  {
    name: "GIN indexes",
    sql: `
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexdef ILIKE '%USING gin%'
      ORDER BY 1
    `,
    check: (rows) => {
      const names = rows.map((r) => String(r.name));
      const absent = missing(
        ["diagram_search_vector_idx", "diagram_snapshot_search_vector_idx"],
        names
      );
      return absent.length === 0
        ? { ok: true, detail: `GIN: ${names.join(", ")}` }
        : { ok: false, detail: `missing GIN index: ${absent.join(", ")}` };
    },
  },
  {
    name: "partial unique indexes",
    sql: `
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef ILIKE '%WHERE%'
      ORDER BY 1
    `,
    check: (rows) => {
      const names = rows.map((r) => String(r.name));
      // The at-most-one-Pending-Version rule (issue #1348) is enforced by this
      // index and nothing else, so its absence is a correctness hole.
      const absent = missing(["course_version_one_pending_uniq"], names);
      return absent.length === 0
        ? { ok: true, detail: `partial unique: ${names.join(", ")}` }
        : {
            ok: false,
            detail: `missing partial unique index: ${absent.join(", ")}`,
          };
    },
  },
  {
    name: "text[] columns",
    sql: `
      SELECT table_name || '.' || column_name AS column,
             udt_name AS type,
             (ARRAY['a','b']::text[])[2] AS array_literal_works
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'ARRAY'
        AND udt_name = '_text'
      ORDER BY 1
    `,
    check: (rows) => {
      const found = rows.map((r) => String(r.column));
      const absent = missing([`${TABLE_PREFIX}lesson.dependencies`], found);
      if (absent.length > 0) {
        return {
          ok: false,
          detail: `missing text[] column: ${absent.join(", ")}`,
        };
      }
      const literalWorks = rows.every((r) => r.array_literal_works === "b");
      return literalWorks
        ? { ok: true, detail: `text[]: ${found.join(", ")}` }
        : {
            ok: false,
            detail: "text[] columns exist but array literals misbehave",
          };
    },
  },
];
