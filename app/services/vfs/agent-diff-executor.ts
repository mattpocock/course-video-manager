import { Effect, Layer } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { clips, chapters, beats, lessons, videos } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type {
  Op,
  AddOp,
  DeleteOp,
  EditFieldOp,
  ReorderOp,
} from "./derive-diff-types";
import { computeContentHash } from "./derive-diff-types";
import type { VfsDirNode } from "./vfs-tree";
import { vfsCat } from "./vfs-cat";
import type { DrizzleDB, Database } from "@/services/drizzle-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { createLessonSectionOperations } from "@/services/db-lesson-section-operations.server";
import { createClipOperations } from "@/services/db-clip-operations.server";
import { createBeatOperations } from "@/services/db-beat-operations.server";
import { createVideoOperations } from "@/services/db-video-operations.server";
import { toSlug } from "@/services/lesson-path-service";
import { buildVfsForCourse } from "./vfs-loader.server";
import {
  isOpFsTouching,
  resolveParentId,
  resolveTimelineItemType,
} from "./agent-diff-executor-helpers";

export type ExecutorContext = {
  db: DrizzleDB;
  courseId: string;
  repoVersionId: string;
  filePath: string | null;
  root: VfsDirNode;
  path: string;
  applyFsOp?: (op: Op) => Effect.Effect<string[], unknown>;
};

export type ExecutorResult = {
  applied: true;
  content: string;
  hash: string;
  renames: string[];
};

export type ExecutorRejection = {
  applied: false;
  rejection: { kind: string; message: string };
};

type TxServices = {
  lessonSectionOps: ReturnType<typeof createLessonSectionOperations>;
  clipOps: ReturnType<typeof createClipOperations>;
  beatOps: ReturnType<typeof createBeatOperations>;
  videoOps: ReturnType<typeof createVideoOperations>;
  tx: Database;
};

export function executeOps(
  ops: Op[],
  ctx: ExecutorContext
): Effect.Effect<
  ExecutorResult | ExecutorRejection,
  UnknownDBServiceError | unknown
> {
  return Effect.gen(function* () {
    const pureDbOps: Op[] = [];
    const fsOps: Op[] = [];

    for (const op of ops) {
      (isOpFsTouching(op, ctx) ? fsOps : pureDbOps).push(op);
    }

    if (fsOps.length > 1) {
      return {
        applied: false as const,
        rejection: {
          kind: "fs-limit",
          message:
            "This edit touches the filesystem in more than one way. Split it into separate edits — each write can contain at most one filesystem-touching operation.",
        },
      };
    }

    const fsOp = fsOps[0] ?? null;
    if (
      fsOp?.type === "edit" &&
      fsOp.entityType === "lesson" &&
      (fsOp as EditFieldOp).field === "fsStatus" &&
      (fsOp as EditFieldOp).after === "real" &&
      ctx.filePath === null
    ) {
      return {
        applied: false as const,
        rejection: {
          kind: "ghost-course",
          message:
            "Cannot materialize a lesson in a ghost course. Materialize the course manually first.",
        },
      };
    }

    yield* withDbTransaction(ctx.db, (tx) =>
      Effect.gen(function* () {
        const svc = buildTxServices(tx);
        for (const op of pureDbOps) {
          yield* applyOp(op, svc, ctx);
        }
      })
    );

    const renames: string[] = [];
    if (fsOp && ctx.applyFsOp) {
      renames.push(...(yield* ctx.applyFsOp(fsOp)));
    }

    const { root: newRoot } = yield* buildVfsForCourse(ctx.courseId).pipe(
      Effect.provide(Layer.succeed(DrizzleService, ctx.db as any))
    );

    const newContent = vfsCat(newRoot, ctx.path);
    return {
      applied: true as const,
      content: newContent,
      hash: computeContentHash(newContent),
      renames,
    };
  });
}

function buildTxServices(tx: Database): TxServices {
  return {
    lessonSectionOps: createLessonSectionOperations(tx),
    clipOps: createClipOperations(tx),
    beatOps: createBeatOperations(tx),
    videoOps: createVideoOperations(tx, {
      getCourseNavigationData: () => Effect.succeed(null as any),
    }),
    tx,
  };
}

function applyOp(
  op: Op,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  switch (op.type) {
    case "add":
      return applyAdd(op, svc, ctx);
    case "delete":
      return applyDelete(op, svc);
    case "edit":
      return applyEdit(op, svc);
    case "reorder":
      return applyReorder(op, svc, ctx);
  }
}

function applyAdd(
  op: AddOp,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  switch (op.sub) {
    case "create":
      return applyCreate(op, svc, ctx);
    case "copy":
      return applyCopy(op, svc, ctx);
    case "unarchive":
      return applyUnarchive(op, svc, ctx);
  }
}

function applyCreate(
  op: AddOp,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    switch (op.entityType) {
      case "section": {
        const slug =
          (op.detail.values?.slug as string) || toSlug(op.target) || "untitled";
        const existing = yield* svc.lessonSectionOps.getSectionsByRepoVersionId(
          ctx.repoVersionId
        );
        const maxOrder =
          existing.length > 0 ? Math.max(...existing.map((s) => s.order)) : 0;
        yield* svc.lessonSectionOps.createSections({
          repoVersionId: ctx.repoVersionId,
          sections: [
            { sectionPathWithNumber: slug, sectionNumber: maxOrder + 1 },
          ],
        });
        break;
      }
      case "lesson": {
        const sectionId = resolveParentId(ctx.root, ctx.path, "section");
        if (!sectionId) break;
        const title = (op.detail.values?.title as string) || op.target;
        const slug =
          (op.detail.values?.slug as string) || toSlug(title) || "untitled";
        const existing =
          yield* svc.lessonSectionOps.getLessonsBySectionId(sectionId);
        const maxOrder =
          existing.length > 0 ? Math.max(...existing.map((l) => l.order)) : 0;
        yield* svc.lessonSectionOps.createGhostLesson(sectionId, {
          title,
          path: slug,
          order: maxOrder + 1,
        });
        break;
      }
      case "video": {
        const lessonId = resolveParentId(ctx.root, ctx.path, "lesson");
        if (!lessonId) break;
        yield* svc.videoOps.createVideo(lessonId, {
          path: (op.detail.values?.name as string) || op.target,
          originalFootagePath: "",
        });
        break;
      }
      case "chapter": {
        const videoId = resolveParentId(ctx.root, ctx.path, "video");
        if (!videoId) break;
        const name =
          (op.detail.values?.label as string) ||
          (op.detail.values?.name as string) ||
          op.target;
        yield* svc.clipOps.createChapterAtInsertionPoint(videoId, name, {
          type: "start",
        });
        break;
      }
      case "beat": {
        const videoId = resolveParentId(ctx.root, ctx.path, "video");
        if (!videoId) break;
        yield* svc.beatOps.createBeat(
          videoId,
          ((op.detail.values?.kind as string) || "definition") as any,
          null,
          (op.detail.values?.title as string) || ""
        );
        break;
      }
      default:
        break;
    }
  });
}

function applyCopy(
  op: AddOp,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    if (op.entityType !== "clip" || !op.detail.footageMatch) return;
    const videoId = resolveParentId(ctx.root, ctx.path, "video");
    if (!videoId) return;
    const { videoFilename, sourceStartTime, sourceEndTime } =
      op.detail.footageMatch;
    const newClips = yield* svc.clipOps.appendClips({
      videoId,
      insertionPoint: { type: "start" },
      clips: [
        {
          inputVideo: videoFilename,
          startTime: sourceStartTime,
          endTime: sourceEndTime,
        },
      ],
    });
    const text = (op.detail.values?.label as string) ?? "";
    if (text && newClips[0])
      yield* svc.clipOps.updateClip(newClips[0].id, { text });
  });
}

function applyUnarchive(
  op: AddOp,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    if (!op.id) return;
    switch (op.entityType) {
      case "lesson": {
        const targetSectionId = resolveParentId(ctx.root, ctx.path, "section");
        if (!targetSectionId) break;
        const existing =
          yield* svc.lessonSectionOps.getLessonsBySectionId(targetSectionId);
        const maxOrder =
          existing.length > 0 ? Math.max(...existing.map((l) => l.order)) : 0;
        yield* dbCall(() =>
          (svc.tx as any)
            .update(lessons)
            .set({
              archived: false,
              sectionId: targetSectionId,
              order: maxOrder + 1,
            })
            .where(eq(lessons.id, op.id!))
        );
        break;
      }
      case "video": {
        const targetLessonId = resolveParentId(ctx.root, ctx.path, "lesson");
        if (!targetLessonId) break;
        yield* dbCall(() =>
          (svc.tx as any)
            .update(videos)
            .set({ archived: false, lessonId: targetLessonId })
            .where(eq(videos.id, op.id!))
        );
        break;
      }
      default:
        break;
    }
  });
}

function applyDelete(op: DeleteOp, svc: TxServices): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    switch (op.entityType) {
      case "section":
        yield* svc.lessonSectionOps.archiveSection(op.id);
        break;
      case "lesson":
        yield* svc.lessonSectionOps.deleteLesson(op.id);
        break;
      case "video":
        yield* svc.videoOps.deleteVideo(op.id);
        break;
      case "clip":
        yield* svc.clipOps.archiveClip(op.id);
        break;
      case "chapter":
        yield* svc.clipOps.archiveChapter(op.id);
        break;
      case "beat":
        yield* svc.beatOps.deleteBeat(op.id);
        break;
      default:
        break;
    }
  });
}

function applyEdit(op: EditFieldOp, svc: TxServices): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    switch (op.entityType) {
      case "section":
        if (op.field === "description")
          yield* svc.lessonSectionOps.updateSectionDescription(
            op.id,
            op.after as string
          );
        else if (op.field === "slug")
          yield* svc.lessonSectionOps.updateSectionPath(
            op.id,
            op.after as string
          );
        break;
      case "lesson": {
        const fieldMap: Record<string, string> = {
          title: "title",
          slug: "path",
          description: "description",
          icon: "icon",
          priority: "priority",
          dependencies: "dependencies",
          authoringStatus: "authoringStatus",
          fsStatus: "fsStatus",
        };
        const dbField = fieldMap[op.field];
        if (dbField)
          yield* svc.lessonSectionOps.updateLesson(op.id, {
            [dbField]: op.after,
          } as any);
        break;
      }
      case "video":
        if (op.field === "name")
          yield* svc.videoOps.updateVideoPath({
            videoId: op.id,
            path: op.after as string,
          });
        break;
      case "clip":
        if (op.field === "text")
          yield* svc.clipOps.updateClip(op.id, { text: op.after as string });
        break;
      case "chapter":
        if (op.field === "name")
          yield* svc.clipOps.updateChapter(op.id, { name: op.after as string });
        break;
      case "beat":
        if (op.field === "title")
          yield* svc.beatOps.renameBeat(op.id, op.after as string);
        else if (op.field === "description")
          yield* svc.beatOps.setBeatDescription(op.id, op.after as string);
        else if (op.field === "kind")
          yield* svc.beatOps.setBeatKind(op.id, op.after as any);
        break;
      default:
        break;
    }
  });
}

function applyReorder(
  op: ReorderOp,
  svc: TxServices,
  ctx: ExecutorContext
): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    const ids = op.order.map((o) => o.id);
    switch (op.entityType) {
      case "section":
        yield* svc.lessonSectionOps.batchUpdateSectionOrders(
          ids.map((id, i) => ({ id, order: i }))
        );
        break;
      case "lesson":
        yield* svc.lessonSectionOps.batchUpdateLessonOrders(
          ids.map((id, i) => ({ id, order: i }))
        );
        break;
      case "clip": {
        const keys = generateNKeysBetween(null, null, ids.length);
        const c: string[] = [],
          co: string[] = [],
          h: string[] = [],
          ho: string[] = [];
        for (let i = 0; i < ids.length; i++) {
          if (
            resolveTimelineItemType(ctx.root, ctx.path, ids[i]!) === "chapter"
          ) {
            h.push(ids[i]!);
            ho.push(keys[i]!);
          } else {
            c.push(ids[i]!);
            co.push(keys[i]!);
          }
        }
        if (c.length > 0) yield* batchUpdateOrder(svc.tx, "clips", c, co);
        if (h.length > 0) yield* batchUpdateOrder(svc.tx, "chapters", h, ho);
        break;
      }
      case "beat": {
        const keys = generateNKeysBetween(null, null, ids.length);
        yield* batchUpdateOrder(svc.tx, "beats", ids, keys);
        break;
      }
      default:
        break;
    }
  });
}

function batchUpdateOrder(
  tx: Database,
  table: "clips" | "chapters" | "beats",
  ids: string[],
  orders: string[]
): Effect.Effect<void, UnknownDBServiceError> {
  if (ids.length === 0) return Effect.void;
  const tableRef =
    table === "clips" ? clips : table === "chapters" ? chapters : beats;
  const orderExpr = sql`case ${sql.join(
    ids.map((id, i) => sql`when ${tableRef.id} = ${id} then ${orders[i]!}`),
    sql` `
  )} end`;
  return dbCall(() =>
    (tx as any)
      .update(tableRef)
      .set({ order: orderExpr })
      .where(inArray(tableRef.id, ids))
  );
}

function dbCall<T>(
  fn: () => Promise<T>
): Effect.Effect<T, UnknownDBServiceError> {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
}
