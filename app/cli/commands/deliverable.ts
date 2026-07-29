import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
  withName,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  DELIVERABLE_HELP,
  LIST_HELP,
  GET_HELP,
  CREATE_HELP,
  UPDATE_HELP,
  ARCHIVE_HELP,
} from "./deliverable.help";

// ---------------------------------------------------------------------------
// Shaping — flatten the join rows into id arrays for an identity-rich record.
// ---------------------------------------------------------------------------

const shape = (row: {
  readonly deliverablesCourses: ReadonlyArray<{ courseId: string }>;
  readonly deliverablesPitches: ReadonlyArray<{ pitchId: string }>;
}) => {
  const { deliverablesCourses, deliverablesPitches, ...rest } = row;
  return withName({
    ...rest,
    courseIds: deliverablesCourses.map((c) => c.courseId),
    pitchIds: deliverablesPitches.map((p) => p.pitchId),
  });
};

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const STATUSES = ["planned", "done", "cancelled"] as const;
type DeliverableStatus = (typeof STATUSES)[number];

const notesOption = Options.text("notes").pipe(
  Options.withDescription('Free-form notes (pass "" to blank them).'),
  Options.optional
);

const statusOption = Options.choice("status", [...STATUSES]).pipe(
  Options.withDescription(
    "Deliverable Status: planned | done | cancelled (manual, reversible)."
  ),
  Options.optional
);

const courseOption = Options.text("course").pipe(
  Options.withDescription("Link a Course by id (repeatable)."),
  Options.repeated
);

const pitchOption = Options.text("pitch").pipe(
  Options.withDescription("Link a Pitch by id (repeatable)."),
  Options.repeated
);

const clearCoursesOption = Options.boolean("clear-courses").pipe(
  Options.withDescription("Remove every Course link.")
);

const clearPitchesOption = Options.boolean("clear-pitches").pipe(
  Options.withDescription("Remove every Pitch link.")
);

const idArg = Args.text({ name: "id" });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Deliverable's date is the CVM's only date-of-intent, and the column is a
 * bare `date`, so a typo silently becomes a real (wrong) deadline. Require
 * strict zero-padded ISO AND a date that actually exists — Postgres would
 * reject 2026-02-31 as a raw DB error (exit 4) and accept "2026-8-1" as a
 * different date than it looks; both should be invalid-input (exit 3).
 */
const requireIsoDate = (date: string) =>
  Effect.gen(function* () {
    if (!DATE_PATTERN.test(date)) {
      return yield* parseError(
        `--date must be an ISO date, YYYY-MM-DD (got "${date}")`,
        "deliverable"
      );
    }
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      return yield* parseError(
        `--date is not a real date: "${date}"`,
        "deliverable"
      );
    }
    return date;
  });

const requireNonBlankTitle = (title: string) =>
  title.trim() === ""
    ? parseError("--title must not be empty", "deliverable")
    : Effect.succeed(title);

/**
 * Resolve repeated link flags into a de-duplicated id list, failing not-found
 * (exit 2) for any id that does not name an ACTIVE Course / Pitch.
 *
 * Validating up front matters: the join tables are FK-constrained, so an
 * unknown id would otherwise surface as an opaque DatabaseError (exit 4) —
 * and, on create, only AFTER the deliverable row had already been inserted.
 * Archived rows are deleted-equivalent across this CLI, so they fail too.
 */
const resolveLinks = (params: {
  readonly courseIds: ReadonlyArray<string>;
  readonly pitchIds: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const courseIds = [...new Set(params.courseIds)];
    const pitchIds = [...new Set(params.pitchIds)];

    const courseOps = yield* CourseOperationsService;
    yield* Effect.forEach(courseIds, (id) =>
      courseOps.getCourseById(id).pipe(
        Effect.catchTag("NotFoundError", () => notFound("course", id)),
        Effect.flatMap((course) =>
          course.archived ? notFound("course", id) : Effect.void
        )
      )
    );

    const pitchOps = yield* PitchOperationsService;
    yield* Effect.forEach(pitchIds, (id) =>
      pitchOps.getPitch(id).pipe(
        Effect.catchTag("NotFoundError", () => notFound("pitch", id)),
        Effect.flatMap((pitch) =>
          pitch.archived ? notFound("pitch", id) : Effect.void
        )
      )
    );

    return { courseIds, pitchIds };
  });

/**
 * Existence + active guard. There is no get-by-id on the Deliverable service,
 * so filter the complete-set `listDeliverables` — which already excludes
 * archived rows, exactly the "archived == deleted" semantics this CLI wants.
 */
const requireActiveDeliverable = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* DeliverableOperationsService;
    const rows = yield* svc.listDeliverables();
    const match = rows.find((r) => r.id === id);
    if (!match) {
      return yield* notFound("deliverable", id);
    }
    return match;
  });

// ---------------------------------------------------------------------------
// Read verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const svc = yield* DeliverableOperationsService;
    const rows = yield* svc.listDeliverables();
    yield* emitNdjson(rows.map(shape));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

// There is no get-by-id getter on the Deliverable service, so synthesize one by
// filtering the complete-set listDeliverables. An absent id resolves to
// undefined (the CLI owns not-found detection; emitGet maps it to exit 2).
const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "deliverable",
    ids,
    fetch: (id) =>
      Effect.flatMap(DeliverableOperationsService, (svc) =>
        svc.listDeliverables().pipe(
          Effect.map((rows) => {
            const match = rows.find((r) => r.id === id);
            return match ? shape(match) : undefined;
          })
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// Write verbs: create / update / archive
//
// There is deliberately NO `update-status` verb even though the HTTP API has
// that route: the route exists because the calendar UI flips status from a
// menu without opening the edit form. On the CLI `update --status <s> <id>`
// is that same call with one fewer verb to learn.
// ---------------------------------------------------------------------------

const createCmd = Command.make(
  "create",
  {
    title: Options.text("title").pipe(
      Options.withDescription("The Deliverable's headline (required).")
    ),
    date: Options.text("date").pipe(
      Options.withDescription("The all-day date, YYYY-MM-DD (required).")
    ),
    notes: notesOption,
    status: statusOption,
    course: courseOption,
    pitch: pitchOption,
  },
  ({ title, date, notes, status, course, pitch }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        yield* requireNonBlankTitle(title);
        yield* requireIsoDate(date);
        // Validate links BEFORE the insert so a bad id leaves nothing behind.
        const links = yield* resolveLinks({
          courseIds: course,
          pitchIds: pitch,
        });

        const svc = yield* DeliverableOperationsService;
        const created = yield* svc.createDeliverable({
          title,
          date,
          notes: Option.getOrUndefined(notes),
          status: Option.getOrUndefined(status) as
            | DeliverableStatus
            | undefined,
          courseIds: links.courseIds,
          pitchIds: links.pitchIds,
        });

        yield* emitObject(
          withName({
            ...created,
            courseIds: links.courseIds,
            pitchIds: links.pitchIds,
          })
        );
      })
    )
).pipe(Command.withDescription(detail(CREATE_HELP)));

const updateCmd = Command.make(
  "update",
  {
    id: idArg,
    title: Options.text("title").pipe(
      Options.withDescription("New headline (rename)."),
      Options.optional
    ),
    date: Options.text("date").pipe(
      Options.withDescription("Re-pin to another date, YYYY-MM-DD."),
      Options.optional
    ),
    notes: notesOption,
    status: statusOption,
    course: courseOption,
    pitch: pitchOption,
    clearCourses: clearCoursesOption,
    clearPitches: clearPitchesOption,
  },
  ({
    id,
    title,
    date,
    notes,
    status,
    course,
    pitch,
    clearCourses,
    clearPitches,
  }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const t = Option.getOrUndefined(title);
        const d = Option.getOrUndefined(date);
        const n = Option.getOrUndefined(notes);
        const s = Option.getOrUndefined(status) as
          | DeliverableStatus
          | undefined;

        yield* rejectBothFlags({
          a: course.length > 0 ? course : undefined,
          b: clearCourses ? true : undefined,
          flags: ["--course", "--clear-courses"],
          entity: "deliverable",
        });
        yield* rejectBothFlags({
          a: pitch.length > 0 ? pitch : undefined,
          b: clearPitches ? true : undefined,
          flags: ["--pitch", "--clear-pitches"],
          entity: "deliverable",
        });

        const touchesLinks =
          course.length > 0 || pitch.length > 0 || clearCourses || clearPitches;
        if (
          t === undefined &&
          d === undefined &&
          n === undefined &&
          s === undefined &&
          !touchesLinks
        ) {
          return yield* parseError(
            "update needs at least one flag (e.g. --date / --status / --title)",
            "deliverable"
          );
        }

        if (t !== undefined) yield* requireNonBlankTitle(t);
        if (d !== undefined) yield* requireIsoDate(d);

        // Existence + active guard (archived == deleted == not addressable).
        const existing = yield* requireActiveDeliverable(id);
        const links = yield* resolveLinks({
          courseIds: course,
          pitchIds: pitch,
        });

        // undefined => leave that noun's links untouched; [] => clear them.
        const courseIds = clearCourses
          ? []
          : course.length > 0
            ? links.courseIds
            : undefined;
        const pitchIds = clearPitches
          ? []
          : pitch.length > 0
            ? links.pitchIds
            : undefined;

        const svc = yield* DeliverableOperationsService;
        // updateDeliverable is a whole-row write, so merge the untouched fields
        // back in from the row we just read: this verb is a PATCH.
        yield* svc.updateDeliverable({
          id,
          title: t ?? existing.title,
          date: d ?? existing.date,
          notes: n ?? existing.notes ?? undefined,
          status: s ?? (existing.status as DeliverableStatus),
          courseIds,
          pitchIds,
        });

        yield* emitObject(shape(yield* requireActiveDeliverable(id)));
      })
    )
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const archiveCmd = Command.make("archive", { id: idArg }, ({ id }) =>
  withBackupCoordination(
    Effect.gen(function* () {
      // Read the links first — once archived the row is unreachable through
      // listDeliverables, so this is the last chance to echo them back.
      const existing = yield* requireActiveDeliverable(id);
      const svc = yield* DeliverableOperationsService;
      const archived = yield* svc.archiveDeliverable(id);
      yield* emitObject(
        shape({
          ...archived,
          deliverablesCourses: existing.deliverablesCourses,
          deliverablesPitches: existing.deliverablesPitches,
        })
      );
    })
  )
).pipe(Command.withDescription(detail(ARCHIVE_HELP)));

// ---------------------------------------------------------------------------
// Noun
// ---------------------------------------------------------------------------

export const deliverableCommand = Command.make("deliverable").pipe(
  Command.withDescription(detail(DELIVERABLE_HELP)),
  Command.withSubcommands([listCmd, getCmd, createCmd, updateCmd, archiveCmd])
);
