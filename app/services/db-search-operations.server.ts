import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import {
  chapters,
  clips,
  courses,
  courseVersions,
  lessons,
  pitches,
  sections,
  segments,
  videos,
} from "@/db/schema";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { and, asc, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Every entity kind search can surface, and thus every `--type` value. */
export type SearchKind =
  | "course"
  | "section"
  | "lesson"
  | "video"
  | "segment"
  | "pitch";

/**
 * One search result. Always self-describing via `kind`, always carrying the
 * matched entity's id, its immediate parent id + owning `courseId` (so a hit is
 * navigable without re-walking), the `field` that matched, and a `snippet`
 * (an excerpt around the match — for short fields, the whole value). Pitches
 * live off the course tree, so they carry no parent/course ids.
 */
export type SearchHit =
  | {
      kind: "course";
      id: string;
      courseId: string;
      name: string;
      field: string;
      snippet: string;
    }
  | {
      kind: "section";
      id: string;
      courseId: string;
      path: string;
      field: string;
      snippet: string;
    }
  | {
      kind: "lesson";
      id: string;
      courseId: string;
      sectionId: string;
      path: string;
      field: string;
      snippet: string;
    }
  | {
      kind: "video";
      id: string;
      courseId: string;
      lessonId: string;
      path: string;
      field: string;
      snippet: string;
    }
  | {
      kind: "segment";
      id: string;
      courseId: string;
      videoId: string;
      title: string;
      field: string;
      snippet: string;
    }
  | {
      kind: "pitch";
      id: string;
      title: string;
      field: string;
      snippet: string;
    };

/**
 * The root a search is confined to. `null` is the top-level search (every
 * active course's Draft tree + all pitches). A scoped root pins the walk to a
 * course / section / lesson subtree — pitches are never in scope there.
 */
export type SearchRoot =
  | null
  | { kind: "course"; id: string }
  | { kind: "section"; id: string }
  | { kind: "lesson"; id: string };

export interface SearchParams {
  readonly root: SearchRoot;
  readonly query: string;
  /** Kinds to include. A hit is emitted only if its kind is in this set. */
  readonly types: ReadonlySet<SearchKind>;
}

// ---------------------------------------------------------------------------
// Matching + snippet helpers (module-scoped, query-parameterised via closures)
// ---------------------------------------------------------------------------

/** A matched field name paired with a snippet excerpt drawn from its value. */
type FieldMatch = { field: string; snippet: string };

/** Chars that are wildcards inside a LIKE/ILIKE pattern; escaped to stay literal. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const SNIPPET_RADIUS = 60;

// ---------------------------------------------------------------------------
// In-memory tree node shapes (only the columns search needs)
// ---------------------------------------------------------------------------

type SegmentNode = {
  id: string;
  title: string;
  description: string;
  videoId: string;
};
type VideoNode = {
  id: string;
  path: string;
  lessonId: string;
  segments: SegmentNode[];
};
type LessonNode = {
  id: string;
  path: string;
  title: string;
  description: string;
  sectionId: string;
  videos: VideoNode[];
};
type SectionNode = {
  id: string;
  path: string;
  description: string;
  lessons: LessonNode[];
};
type CourseHead = { id: string; name: string; slug: string | null };

// Nested `with` selection shared by every tree loader (section subtree down).
const sectionWith = {
  columns: { id: true, path: true, description: true, order: true },
  where: isNull(sections.archivedAt),
  orderBy: asc(sections.order),
  with: {
    lessons: {
      columns: {
        id: true,
        path: true,
        title: true,
        description: true,
        order: true,
        sectionId: true,
      },
      where: eq(lessons.archived, false),
      orderBy: asc(lessons.order),
      with: {
        videos: {
          columns: { id: true, path: true, lessonId: true },
          where: eq(videos.archived, false),
          orderBy: asc(videos.path),
          with: {
            segments: {
              columns: {
                id: true,
                title: true,
                description: true,
                order: true,
                videoId: true,
              },
              where: eq(segments.archived, false),
              orderBy: asc(segments.order),
            },
          },
        },
      },
    },
  },
} as const;

export const createSearchOperations = (db: Database) => {
  /**
   * Search the entity tree for a literal, case-insensitive substring.
   *
   * Returns hits in depth-first Draft-tree order (course -> sections -> lessons
   * -> videos -> segments), courses in `course list` order, pitches last. One
   * hit per entity (first matching field wins, path before transcript). When a
   * scoped `root` id is missing or archived, returns `null` so the CLI can own
   * not-found detection.
   */
  const search = Effect.fn("search")(function* (params: SearchParams) {
    const { root, query, types } = params;

    const ql = query.toLowerCase();
    const pattern = `%${escapeLike(query)}%`;

    const matches = (value: string | null | undefined): boolean =>
      typeof value === "string" && value.toLowerCase().includes(ql);

    // `matches`/ILIKE compare the query against the RAW value, but the snippet
    // is drawn from a whitespace-collapsed copy. Collapse the needle the same
    // way so a query containing a run of whitespace still locates in `collapsed`
    // (otherwise `indexOf` returns -1 and the snippet is a misleading prefix).
    const needle = ql.replace(/\s+/g, " ").trim();

    /** Build an excerpt of ~SNIPPET_RADIUS chars either side of the match. */
    const snippet = (value: string): string => {
      const collapsed = value.replace(/\s+/g, " ").trim();
      const idx = collapsed.toLowerCase().indexOf(needle);
      if (idx === -1) return collapsed.slice(0, SNIPPET_RADIUS * 2);
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(
        collapsed.length,
        idx + needle.length + SNIPPET_RADIUS
      );
      let out = collapsed.slice(start, end);
      if (start > 0) out = `…${out}`;
      if (end < collapsed.length) out = `${out}…`;
      return out;
    };

    /** First matching field of an ordered [field, value] list, with snippet. */
    const firstMatch = (
      fields: ReadonlyArray<readonly [string, string]>
    ): FieldMatch | null => {
      for (const [field, value] of fields) {
        if (matches(value)) return { field, snippet: snippet(value) };
      }
      return null;
    };

    // -- Resolve the scoped subtree (or every course for a top-level search) --

    let courseHead: CourseHead | null = null; // present => emit a course hit path
    let courseId = ""; // owning course for the walked subtree
    let sectionNodes: SectionNode[] = [];
    // A lesson root walks a single lesson's subtree (no section above it).
    let lessonRoot: LessonNode | null = null;
    let courseHeads: Array<{ head: CourseHead; sections: SectionNode[] }> = [];

    // Whether any tree kind (everything but `pitch`) is in scope. A top-level
    // `--type pitch` search wants no tree node, so the whole per-course tree
    // load below can be skipped — pitches are queried separately at the end.
    const wantsTree =
      types.has("course") ||
      types.has("section") ||
      types.has("lesson") ||
      types.has("video") ||
      types.has("segment");

    if (root === null) {
      if (wantsTree) {
        const rows = yield* makeDbCall(() =>
          db.query.courses.findMany({
            where: eq(courses.archived, false),
            columns: { id: true, name: true, slug: true },
            with: {
              versions: {
                columns: { id: true },
                orderBy: desc(courseVersions.createdAt),
                limit: 1,
                with: { sections: sectionWith },
              },
            },
          })
        );
        courseHeads = rows.map((c) => ({
          head: { id: c.id, name: c.name, slug: c.slug },
          sections: (c.versions[0]?.sections ?? []) as SectionNode[],
        }));
      }
    } else if (root.kind === "course") {
      const c = yield* makeDbCall(() =>
        db.query.courses.findFirst({
          where: and(eq(courses.id, root.id), eq(courses.archived, false)),
          columns: { id: true, name: true, slug: true },
          with: {
            versions: {
              columns: { id: true },
              orderBy: desc(courseVersions.createdAt),
              limit: 1,
              with: { sections: sectionWith },
            },
          },
        })
      );
      if (!c) return null;
      courseHead = { id: c.id, name: c.name, slug: c.slug };
      courseId = c.id;
      sectionNodes = (c.versions[0]?.sections ?? []) as SectionNode[];
    } else if (root.kind === "section") {
      const sec = yield* makeDbCall(() =>
        db.query.sections.findFirst({
          where: and(eq(sections.id, root.id), isNull(sections.archivedAt)),
          columns: { id: true, path: true, description: true, order: true },
          with: {
            repoVersion: { columns: { repoId: true } },
            lessons: sectionWith.with.lessons,
          },
        })
      );
      if (!sec) return null;
      courseId = sec.repoVersion?.repoId ?? "";
      sectionNodes = [
        {
          id: sec.id,
          path: sec.path,
          description: sec.description,
          lessons: sec.lessons as LessonNode[],
        },
      ];
    } else {
      // lesson root
      const les = yield* makeDbCall(() =>
        db.query.lessons.findFirst({
          where: and(eq(lessons.id, root.id), eq(lessons.archived, false)),
          columns: {
            id: true,
            path: true,
            title: true,
            description: true,
            sectionId: true,
          },
          with: {
            section: {
              columns: { id: true },
              with: { repoVersion: { columns: { repoId: true } } },
            },
            videos: sectionWith.with.lessons.with.videos,
          },
        })
      );
      if (!les) return null;
      courseId = les.section?.repoVersion?.repoId ?? "";
      lessonRoot = {
        id: les.id,
        path: les.path,
        title: les.title,
        description: les.description,
        sectionId: les.sectionId,
        videos: les.videos as VideoNode[],
      };
    }

    // -- Transcript matching (SQL): which in-scope videos have a matching clip
    //    or chapter, plus a snippet drawn from the first matching clip. --------

    // Gather every in-scope video id across all three tree shapes we may have
    // populated above: a scoped subtree (`sectionNodes`), a lone lesson root
    // (`lessonRoot`), or the top-level per-course sections (`courseHeads`). Only
    // one of these is non-empty for any given call; reading all three from the
    // closure keeps the collector's inputs explicit rather than half-passed.
    const collectVideoIds = (): string[] => {
      const ids: string[] = [];
      for (const sec of sectionNodes)
        for (const les of sec.lessons)
          for (const v of les.videos) ids.push(v.id);
      if (lessonRoot) for (const v of lessonRoot.videos) ids.push(v.id);
      for (const { sections: secs } of courseHeads)
        for (const sec of secs)
          for (const les of sec.lessons)
            for (const v of les.videos) ids.push(v.id);
      return ids;
    };

    const videoIds = collectVideoIds();
    const transcriptMatch = new Map<string, FieldMatch>();

    if (videoIds.length > 0 && types.has("video")) {
      const clipRows = yield* makeDbCall(() =>
        db
          .select({ videoId: clips.videoId, text: clips.text })
          .from(clips)
          .where(
            and(
              inArray(clips.videoId, videoIds),
              eq(clips.archived, false),
              ilike(clips.text, pattern)
            )
          )
          .orderBy(asc(clips.videoId), asc(clips.order))
      );
      for (const c of clipRows) {
        if (!transcriptMatch.has(c.videoId))
          transcriptMatch.set(c.videoId, {
            field: "transcript",
            snippet: snippet(c.text),
          });
      }
      const chapterRows = yield* makeDbCall(() =>
        db
          .select({ videoId: chapters.videoId, name: chapters.name })
          .from(chapters)
          .where(
            and(
              inArray(chapters.videoId, videoIds),
              eq(chapters.archived, false),
              ilike(chapters.name, pattern)
            )
          )
          .orderBy(asc(chapters.videoId), asc(chapters.order))
      );
      for (const ch of chapterRows) {
        if (!transcriptMatch.has(ch.videoId))
          transcriptMatch.set(ch.videoId, {
            field: "transcript",
            snippet: snippet(ch.name),
          });
      }
    }

    // -- Depth-first emit ----------------------------------------------------

    const hits: SearchHit[] = [];
    const want = (k: SearchKind) => types.has(k);

    const emitVideo = (v: VideoNode, cid: string) => {
      if (want("video")) {
        const m =
          (matches(v.path)
            ? { field: "path", snippet: snippet(v.path) }
            : null) ?? transcriptMatch.get(v.id);
        if (m)
          hits.push({
            kind: "video",
            id: v.id,
            courseId: cid,
            lessonId: v.lessonId,
            path: v.path,
            field: m.field,
            snippet: m.snippet,
          });
      }
      if (want("segment")) {
        for (const seg of v.segments) {
          const m = firstMatch([
            ["title", seg.title],
            ["description", seg.description],
          ]);
          if (m)
            hits.push({
              kind: "segment",
              id: seg.id,
              courseId: cid,
              videoId: seg.videoId,
              title: seg.title,
              field: m.field,
              snippet: m.snippet,
            });
        }
      }
    };

    const emitLesson = (les: LessonNode, cid: string) => {
      if (want("lesson")) {
        const m = firstMatch([
          ["path", les.path],
          ["title", les.title],
          ["description", les.description],
        ]);
        if (m)
          hits.push({
            kind: "lesson",
            id: les.id,
            courseId: cid,
            sectionId: les.sectionId,
            path: les.path,
            field: m.field,
            snippet: m.snippet,
          });
      }
      for (const v of les.videos) emitVideo(v, cid);
    };

    const emitSection = (sec: SectionNode, cid: string) => {
      if (want("section")) {
        const m = firstMatch([
          ["path", sec.path],
          ["description", sec.description],
        ]);
        if (m)
          hits.push({
            kind: "section",
            id: sec.id,
            courseId: cid,
            path: sec.path,
            field: m.field,
            snippet: m.snippet,
          });
      }
      for (const les of sec.lessons) emitLesson(les, cid);
    };

    const emitCourse = (head: CourseHead, secs: SectionNode[]) => {
      if (want("course")) {
        const m = firstMatch([
          ["name", head.name],
          ["slug", head.slug ?? ""],
        ]);
        if (m)
          hits.push({
            kind: "course",
            id: head.id,
            courseId: head.id,
            name: head.name,
            field: m.field,
            snippet: m.snippet,
          });
      }
      for (const sec of secs) emitSection(sec, head.id);
    };

    if (root === null) {
      for (const { head, sections: secs } of courseHeads)
        emitCourse(head, secs);
    } else if (courseHead) {
      emitCourse(courseHead, sectionNodes);
    } else if (lessonRoot) {
      emitLesson(lessonRoot, courseId);
    } else {
      for (const sec of sectionNodes) emitSection(sec, courseId);
    }

    // -- Pitches (top-level only), appended last -----------------------------

    if (root === null && want("pitch")) {
      const pitchRows = yield* makeDbCall(() =>
        db.query.pitches.findMany({
          where: eq(pitches.archived, false),
          orderBy: asc(pitches.createdAt),
        })
      );
      for (const p of pitchRows) {
        const m = firstMatch([
          ["title", p.title],
          ["description", p.description],
          ["contentPlan", p.contentPlan],
          ["youtubeTitle", p.youtubeTitle],
          ["youtubeThumbnailDescription", p.youtubeThumbnailDescription],
          ["newsletterTitle", p.newsletterTitle],
          ["tweet", p.tweet],
        ]);
        if (m)
          hits.push({
            kind: "pitch",
            id: p.id,
            title: p.title,
            field: m.field,
            snippet: m.snippet,
          });
      }
    }

    return hits;
  });

  return { search };
};

export class SearchOperationsService extends Effect.Service<SearchOperationsService>()(
  "SearchOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createSearchOperations(db);
    }),
  }
) {}
