import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  LearningGoalOperationsService,
  type LearningGoalFields,
} from "@/services/db-learning-goal-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
} from "@/cli/helpers";
import {
  HELP,
  LIST_HELP,
  GET_HELP,
  CREATE_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  DELETE_HELP,
} from "./learning-goal.help";

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const sectionOption = Options.text("section").pipe(
  Options.withDescription("The parent Section id (required).")
);

const titleOption = Options.text("title").pipe(
  Options.withDescription("The Learning Goal's short label."),
  Options.optional
);

const descriptionOption = Options.text("description").pipe(
  Options.withDescription(
    "Free-text statement of what the learner should come away knowing."
  ),
  Options.optional
);

const priorityOption = Options.integer("priority").pipe(
  Options.withDescription("Triage rank (integer; lower sorts first)."),
  Options.optional
);

const unlinkBeatOption = Options.text("unlink-beat").pipe(
  Options.withDescription(
    "Remove this Beat id's link to the Learning Goal (a single-link removal, " +
      "not a content patch)."
  ),
  Options.optional
);

const beforeOption = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this Learning Goal (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOption = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this Learning Goal (mutually exclusive with --before)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });
const ids = Args.text({ name: "id" }).pipe(Args.repeated);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve --before/--after against a set of siblings already in list order. */
const resolveBeforeId = (params: {
  readonly siblings: ReadonlyArray<{ id: string }>;
  readonly before: Option.Option<string>;
  readonly after: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const before = Option.getOrUndefined(params.before);
    const after = Option.getOrUndefined(params.after);

    yield* rejectBothFlags({
      a: before,
      b: after,
      flags: ["--before", "--after"],
      entity: "learningGoal",
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    if (before !== undefined) {
      if (!params.siblings.some((s) => s.id === before)) {
        return yield* notFound("learningGoal", before);
      }
      return before;
    }

    const idx = params.siblings.findIndex((s) => s.id === after);
    if (idx === -1) {
      return yield* notFound("learningGoal", after!);
    }
    return params.siblings[idx + 1]?.id ?? null;
  });

const requireActiveLearningGoal = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* LearningGoalOperationsService;
    const row = yield* svc
      .getLearningGoalById(id)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFound("learningGoal", id))
      );
    if (row.archived) {
      return yield* notFound("learningGoal", id);
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make(
  "list",
  { section: sectionOption },
  ({ section }) =>
    Effect.gen(function* () {
      const svc = yield* LearningGoalOperationsService;
      const rows = yield* svc.listLearningGoalsBySectionId(section);
      yield* emitNdjson(rows);
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "learningGoal",
    ids,
    fetch: (id) =>
      Effect.flatMap(LearningGoalOperationsService, (svc) =>
        svc.getLearningGoalById(id).pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
          Effect.map((row) => (row?.archived ? undefined : row))
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const createCmd = Command.make(
  "create",
  {
    section: sectionOption,
    title: titleOption,
    description: descriptionOption,
    priority: priorityOption,
    before: beforeOption,
    after: afterOption,
  },
  ({ section, title, description, priority, before, after }) =>
    Effect.gen(function* () {
      const svc = yield* LearningGoalOperationsService;
      const siblings = yield* svc.listLearningGoalsBySectionId(section);
      const beforeLearningGoalId = yield* resolveBeforeId({
        siblings,
        before,
        after,
      });
      const fields: LearningGoalFields = {
        title: Option.getOrUndefined(title),
        description: Option.getOrUndefined(description),
        priority: Option.getOrUndefined(priority),
      };
      const goal = yield* svc.createLearningGoal(
        section,
        fields,
        beforeLearningGoalId
      );
      yield* emitObject(goal);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

const updateCmd = Command.make(
  "update",
  {
    id: idArg,
    title: titleOption,
    description: descriptionOption,
    priority: priorityOption,
    unlinkBeat: unlinkBeatOption,
  },
  ({ id, title, description, priority, unlinkBeat }) =>
    Effect.gen(function* () {
      const fields: LearningGoalFields = {
        title: Option.getOrUndefined(title),
        description: Option.getOrUndefined(description),
        priority: Option.getOrUndefined(priority),
      };
      const unlinkBeatId = Option.getOrUndefined(unlinkBeat);
      const touchesContent = Object.values(fields).some((v) => v !== undefined);

      if (!touchesContent && unlinkBeatId === undefined) {
        return yield* parseError(
          "update needs at least one of --title / --description / --priority / --unlink-beat",
          "learningGoal"
        );
      }

      const svc = yield* LearningGoalOperationsService;
      let row = yield* requireActiveLearningGoal(id);
      if (touchesContent) row = yield* svc.updateLearningGoal(id, fields);
      if (unlinkBeatId !== undefined) {
        row = yield* svc.unlinkBeat(id, unlinkBeatId);
      }
      yield* emitObject(row);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  {
    id: idArg,
    before: beforeOption,
    after: afterOption,
  },
  ({ id, before, after }) =>
    Effect.gen(function* () {
      const svc = yield* LearningGoalOperationsService;
      const current = yield* requireActiveLearningGoal(id);
      const siblings = (yield* svc.listLearningGoalsBySectionId(
        current.sectionId
      )).filter((s) => s.id !== id);
      const beforeLearningGoalId = yield* resolveBeforeId({
        siblings,
        before,
        after,
      });
      const moved = yield* svc
        .moveLearningGoal(id, beforeLearningGoalId)
        .pipe(
          Effect.catchTag("NotFoundError", (e) =>
            notFound("learningGoal", (e.params as { id?: string }).id ?? id)
          )
        );
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* LearningGoalOperationsService;
    yield* requireActiveLearningGoal(id);
    yield* svc.deleteLearningGoal(id);
    const archived = yield* svc
      .getLearningGoalById(id)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFound("learningGoal", id))
      );
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const learningGoalCommand = Command.make("learning-goal").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    createCmd,
    updateCmd,
    moveCmd,
    deleteCmd,
  ])
);
