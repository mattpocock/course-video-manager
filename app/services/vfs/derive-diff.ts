import { lookupPath, type VfsDirNode } from "./vfs-tree";
import { vfsCat } from "./vfs-cat";
import { applyEdits } from "@/features/article-writer/document-editing-engine";
import { z } from "zod";
import {
  CAPABILITY_MATRIX,
  MANIFEST_SCHEMAS,
  computeContentHash,
  resolveFileType,
  type EntityType,
  type ManifestEntityType,
  type Op,
  type DiffInput,
  type DiffResult,
  type DiffContext,
  type DiffMessage,
  type ToolResultPart,
  type CatStamp,
} from "./derive-diff-types";

export {
  computeContentHash,
  resolveFileType,
  CAPABILITY_MATRIX,
} from "./derive-diff-types";
export type {
  DiffInput,
  WriteInput,
  EditInput,
  DiffResult,
  DiffContext,
  DiffMessage,
  CatStamp,
  ArchivedEntity,
  Op,
  AddOp,
  DeleteOp,
  EditFieldOp,
  ReorderOp,
  Rejection,
  RejectionKind,
  EntityType,
  FileType,
} from "./derive-diff-types";

function scanForLastCat(
  messages: DiffMessage[],
  path: string
): CatStamp | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (typeof msg.content === "string") continue;
    for (const part of msg.content) {
      if (
        part.type === "tool-result" &&
        (part as ToolResultPart).toolName === "cat"
      ) {
        const result = (part as ToolResultPart).result;
        if (
          result &&
          typeof result === "object" &&
          "path" in result &&
          "hash" in result &&
          "content" in result
        ) {
          const stamp = result as CatStamp;
          if (stamp.path === path) return stamp;
        }
      }
    }
  }
  return null;
}

function memberLabel(
  member: Record<string, unknown>,
  entityType: ManifestEntityType
): string {
  if (entityType === "lesson" || entityType === "section")
    return (
      (member.title as string) ||
      (member.slug as string) ||
      (member.id as string) ||
      "unknown"
    );
  if (entityType === "video")
    return (member.name as string) || (member.id as string) || "unknown";
  if (entityType === "timeline")
    return (member.label as string) || (member.id as string) || "unknown";
  if (entityType === "segment")
    return (member.title as string) || (member.id as string) || "unknown";
  return (member.id as string) || "unknown";
}

function leafLabel(data: Record<string, unknown>): string {
  return (
    (data.title as string) ||
    (data.name as string) ||
    (data.slug as string) ||
    (data.label as string) ||
    (data.text as string)?.slice(0, 40) ||
    (data.id as string) ||
    "unknown"
  );
}

function manifestTarget(entityType: ManifestEntityType): string {
  if (entityType === "timeline") return "timeline";
  return `${entityType}s`;
}

type ExistingClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

function collectAllClips(root: VfsDirNode): ExistingClip[] {
  const clips: ExistingClip[] = [];
  walkTree(root, (node) => {
    if (node.kind === "file" && typeof node.data === "object") {
      const data = node.data as Record<string, unknown>;
      if (
        data.type === "clip" &&
        typeof data.videoFilename === "string" &&
        typeof data.sourceStartTime === "number" &&
        typeof data.sourceEndTime === "number"
      ) {
        clips.push({
          videoFilename: data.videoFilename,
          sourceStartTime: data.sourceStartTime,
          sourceEndTime: data.sourceEndTime,
        });
      }
    }
  });
  return clips;
}

function walkTree(
  node: VfsDirNode,
  visit: (
    n: VfsDirNode["children"] extends Map<string, infer V> ? V : never
  ) => void
): void {
  for (const child of node.children.values()) {
    visit(child);
    if (child.kind === "dir") walkTree(child, visit);
  }
}

function isSectionEmpty(root: VfsDirNode, sectionPath: string): boolean {
  const sectionDir = lookupPath(root, sectionPath);
  if (sectionDir.type !== "dir") return true;
  const lessonsDir = sectionDir.node.children.get("lessons");
  if (!lessonsDir || lessonsDir.kind !== "dir") return true;
  const membersFile = lessonsDir.children.get("_members.json");
  if (!membersFile || membersFile.kind !== "file") return true;
  const members = membersFile.data;
  return Array.isArray(members) && members.length === 0;
}

function findSectionPathForMember(
  root: VfsDirNode,
  manifestPath: string,
  memberId: string
): string | null {
  const parts = manifestPath.split("/").filter(Boolean);
  const sectionsIdx = parts.indexOf("sections");
  if (sectionsIdx < 0 || sectionsIdx + 1 >= parts.length) return null;
  const sectionsBase = "/" + parts.slice(0, sectionsIdx + 1).join("/");
  const sectionsDir = lookupPath(root, sectionsBase);
  if (sectionsDir.type !== "dir") return null;
  for (const [name, child] of sectionsDir.node.children) {
    if (child.kind !== "dir") continue;
    const sectionJson = child.children.get("section.json");
    if (
      sectionJson?.kind === "file" &&
      typeof sectionJson.data === "object" &&
      !Array.isArray(sectionJson.data) &&
      (sectionJson.data as Record<string, unknown>).id === memberId
    ) {
      return sectionsBase + "/" + name;
    }
  }
  return null;
}

function classifyManifestOps(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  entityType: ManifestEntityType,
  ctx: DiffContext,
  manifestPath: string
): DiffResult {
  const afterIds = after.map((m) => m.id as string | null | undefined);
  const nonNullAfterIds = afterIds.filter(
    (id): id is string => id != null && id !== ""
  );

  const seen = new Set<string>();
  for (const id of nonNullAfterIds) {
    if (seen.has(id))
      return {
        ok: false,
        rejection: {
          kind: "identity-error",
          message: `Duplicate id "${id}" in the proposed ${manifestTarget(entityType)} manifest. Each entry must have a unique id.`,
        },
      };
    seen.add(id);
  }

  const beforeIds = before
    .map((m) => m.id as string)
    .filter((id) => id != null);
  const beforeIdSet = new Set(beforeIds);
  const afterIdSet = new Set(nonNullAfterIds);

  for (const id of nonNullAfterIds) {
    if (!beforeIdSet.has(id) && !ctx.archived.has(id))
      return {
        ok: false,
        rejection: {
          kind: "identity-error",
          message: `Unknown id "${id}" in the proposed ${manifestTarget(entityType)} manifest. You cannot invent new ids; use null/omit the id field to create a new entry.`,
        },
      };
  }

  const ops: Op[] = [];
  let note: string | undefined;

  for (const beforeMember of before) {
    const id = beforeMember.id as string | null | undefined;
    if (id == null || id === "") continue;
    if (afterIdSet.has(id)) continue;

    const deleteEntityType: EntityType =
      entityType === "timeline"
        ? beforeMember.type === "chapter"
          ? "chapter"
          : "clip"
        : (entityType as EntityType);

    const delCap = CAPABILITY_MATRIX[deleteEntityType];
    if (!delCap.delete)
      return {
        ok: false,
        rejection: {
          kind: "forbidden-op",
          message: `Cannot delete ${deleteEntityType} "${memberLabel(beforeMember, entityType)}". Deletion is not allowed for this entity type.`,
        },
      };

    if (delCap.delete === "empty-only" && entityType === "section") {
      const sectionPath = findSectionPathForMember(ctx.root, manifestPath, id);
      if (sectionPath && !isSectionEmpty(ctx.root, sectionPath))
        return {
          ok: false,
          rejection: {
            kind: "non-empty-section",
            message: `Cannot delete section "${memberLabel(beforeMember, entityType)}" because it still contains lessons. Move or delete all lessons first.`,
          },
        };
    }

    ops.push({
      type: "delete",
      entityType: deleteEntityType,
      target: memberLabel(beforeMember, entityType),
      id,
    });
  }

  let existingClipsCache: ExistingClip[] | null = null;
  for (const member of after) {
    const id = member.id as string | null | undefined;
    if (id != null && id !== "") continue;

    let addEntityType: EntityType;
    if (entityType === "timeline")
      addEntityType = member.type === "chapter" ? "chapter" : "clip";
    else addEntityType = entityType as EntityType;

    const cap = CAPABILITY_MATRIX[addEntityType];
    if (!cap.add)
      return {
        ok: false,
        rejection: {
          kind: "forbidden-op",
          message: `Cannot add ${addEntityType}. Adding is not allowed for this entity type.`,
        },
      };

    if (cap.add === "copy-only") {
      const videoFilename = member.videoFilename as string | undefined;
      const sourceStartTime = member.sourceStartTime as number | undefined;
      const sourceEndTime = member.sourceEndTime as number | undefined;
      if (
        videoFilename == null ||
        sourceStartTime == null ||
        sourceEndTime == null
      )
        return {
          ok: false,
          rejection: {
            kind: "forbidden-op",
            message: `Cannot add a new clip without specifying the source footage (videoFilename, sourceStartTime, sourceEndTime). Clips can only be added by copying an existing clip's footage.`,
          },
        };

      const allClips = (existingClipsCache ??= collectAllClips(ctx.root));
      const match = allClips.find(
        (c) =>
          c.videoFilename === videoFilename &&
          c.sourceStartTime === sourceStartTime &&
          c.sourceEndTime === sourceEndTime
      );
      if (!match)
        return {
          ok: false,
          rejection: {
            kind: "forbidden-op",
            message: `Cannot add clip: no existing clip matches the footage (videoFilename="${videoFilename}", sourceStartTime=${sourceStartTime}, sourceEndTime=${sourceEndTime}). Clips can only be added by copying existing footage.`,
          },
        };

      ops.push({
        type: "add",
        sub: "copy",
        entityType: addEntityType,
        target: memberLabel(member, entityType),
        detail: {
          footageMatch: { videoFilename, sourceStartTime, sourceEndTime },
          values: Object.fromEntries(
            Object.entries(member).filter(([k]) => k !== "id")
          ),
        },
      });
      continue;
    }

    ops.push({
      type: "add",
      sub: "create",
      entityType: addEntityType,
      target: memberLabel(member, entityType),
      detail: {
        values: Object.fromEntries(
          Object.entries(member).filter(([k]) => k !== "id")
        ),
      },
    });
  }

  for (const member of after) {
    const id = member.id as string | null | undefined;
    if (id == null || id === "") continue;
    if (beforeIdSet.has(id)) continue;
    const archivedEntity = ctx.archived.get(id);
    if (!archivedEntity) continue;

    if (
      archivedEntity.entityType !== "lesson" &&
      archivedEntity.entityType !== "video"
    )
      return {
        ok: false,
        rejection: {
          kind: "forbidden-op",
          message: `Cannot unarchive ${archivedEntity.entityType} "${memberLabel(member, entityType)}". Only lessons and videos can be moved between parents via the archive/unarchive mechanism.`,
        },
      };

    ops.push({
      type: "add",
      sub: "unarchive",
      entityType: archivedEntity.entityType,
      target: memberLabel(member, entityType),
      id: member.id as string,
      detail: { sourceParent: archivedEntity.parentLabel },
    });
    note = `Step 2 of 2: This re-adds "${memberLabel(member, entityType)}" (previously removed from "${archivedEntity.parentLabel}"). Rejecting will leave it archived.`;
  }

  const currentNonNullAfterIds = after
    .map((m) => m.id as string | null | undefined)
    .filter((id): id is string => id != null && id !== "");
  const survivingBeforeIds = beforeIds.filter((id) => afterIdSet.has(id));
  const survivingAfterIds = currentNonNullAfterIds.filter((id) =>
    beforeIdSet.has(id)
  );

  if (
    survivingBeforeIds.length === survivingAfterIds.length &&
    survivingBeforeIds.length > 0 &&
    !survivingBeforeIds.every((id, i) => id === survivingAfterIds[i])
  ) {
    const reorderEntityType =
      entityType === "timeline"
        ? ("clip" as EntityType)
        : (entityType as EntityType);
    const cap = CAPABILITY_MATRIX[reorderEntityType];
    if (!cap.reorder)
      return {
        ok: false,
        rejection: {
          kind: "forbidden-op",
          message: `Cannot reorder ${manifestTarget(entityType)}. Reordering is not allowed for this entity type.`,
        },
      };

    const beforeIndexMap = new Map(survivingBeforeIds.map((id, i) => [id, i]));
    const order = survivingAfterIds.map((id, toIndex) => {
      const fromIndex = beforeIndexMap.get(id)!;
      const afterMember = after.find((m) => (m.id as string) === id)!;
      return {
        id,
        label: memberLabel(afterMember, entityType),
        fromIndex,
        toIndex,
      };
    });

    ops.push({
      type: "reorder",
      entityType: reorderEntityType,
      target: manifestTarget(entityType),
      order,
    });
  }

  return { ok: true, ops, ...(note ? { note } : {}) };
}

function classifyLeafOps(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  entityType: EntityType
): DiffResult {
  if (before.id !== after.id)
    return {
      ok: false,
      rejection: {
        kind: "identity-error",
        message: `Cannot change the id of a ${entityType} (was "${before.id}", got "${after.id}"). Ids are read-only.`,
      },
    };

  const cap = CAPABILITY_MATRIX[entityType];
  const ops: Op[] = [];
  const id = before.id as string;
  const target = leafLabel(before);

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "id") continue;
    const bVal = before[key];
    const aVal = after[key];
    if (deepEqual(bVal, aVal)) continue;

    if (!cap.editableFields.includes(key))
      return {
        ok: false,
        rejection: {
          kind: "forbidden-op",
          message: `Cannot edit field "${key}" on ${entityType} "${target}". Editable fields for ${entityType}: ${cap.editableFields.length > 0 ? cap.editableFields.join(", ") : "none"}.`,
        },
      };

    ops.push({
      type: "edit",
      entityType,
      target,
      id,
      field: key,
      before: bVal,
      after: aVal,
    });
  }

  return { ok: true, ops };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      if (!deepEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

export function deriveDiff(
  input: DiffInput,
  messages: DiffMessage[],
  ctx: DiffContext
): DiffResult {
  const { path } = input;
  const fileType = resolveFileType(path);
  if (!fileType)
    return {
      ok: false,
      rejection: {
        kind: "invalid-file",
        message: `Cannot write to "${path}": unrecognized VFS file type.`,
      },
    };

  const lastCat = scanForLastCat(messages, path);
  if (!lastCat)
    return {
      ok: false,
      rejection: {
        kind: "not-read",
        message: `You must read "${path}" with cat before writing to it.`,
      },
    };

  const currentContent = vfsCat(ctx.root, path);
  if (
    currentContent.startsWith("cat: ") &&
    currentContent.includes("No such file")
  )
    return {
      ok: false,
      rejection: {
        kind: "invalid-file",
        message: `Cannot write to "${path}": file does not exist.`,
      },
    };

  const currentHash = computeContentHash(currentContent);
  if (lastCat.hash !== currentHash)
    return {
      ok: false,
      rejection: {
        kind: "stale",
        message: `The file "${path}" has changed since you last read it. Read it again with cat before editing.`,
      },
    };

  let afterContent: string;
  if ("content" in input) {
    afterContent = input.content;
  } else {
    const editResult = applyEdits(lastCat.content, input.edits);
    if ("error" in editResult)
      return {
        ok: false,
        rejection: { kind: "edit-error", message: editResult.error },
      };
    afterContent = editResult.document;
  }

  let beforeData: unknown;
  let afterData: unknown;
  try {
    beforeData = JSON.parse(currentContent);
  } catch {
    return {
      ok: false,
      rejection: {
        kind: "parse-error",
        message: `Failed to parse current content of "${path}".`,
      },
    };
  }
  try {
    afterData = JSON.parse(afterContent);
  } catch {
    return {
      ok: false,
      rejection: {
        kind: "parse-error",
        message: `Failed to parse proposed content for "${path}". Ensure the content is valid JSON.`,
      },
    };
  }

  if (fileType.kind === "manifest") {
    const schema = MANIFEST_SCHEMAS[fileType.entityType];
    const parseResult = schema.safeParse(afterData);
    if (!parseResult.success)
      return {
        ok: false,
        rejection: {
          kind: "parse-error",
          message: `Invalid manifest format for "${path}":\n${z.prettifyError(parseResult.error)}`,
        },
      };
    return classifyManifestOps(
      beforeData as Array<Record<string, unknown>>,
      parseResult.data as Array<Record<string, unknown>>,
      fileType.entityType,
      ctx,
      path
    );
  }

  return classifyLeafOps(
    beforeData as Record<string, unknown>,
    afterData as Record<string, unknown>,
    fileType.entityType
  );
}
