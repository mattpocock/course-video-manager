import type { VfsDirNode, VfsNode } from "./vfs-tree";
import { lookupPath } from "./vfs-tree";
import type { Op } from "./derive-diff-types";
import type { ExecutorContext } from "./agent-diff-executor";

export function isOpFsTouching(op: Op, ctx: ExecutorContext): boolean {
  if (
    op.type === "edit" &&
    op.entityType === "lesson" &&
    op.field === "fsStatus"
  )
    return true;

  if (ctx.filePath === null) return false;

  if (op.type === "edit" && op.entityType === "lesson" && op.field === "slug") {
    const leaf = findLeafData(ctx.root, "lesson", op.id);
    return leaf?.fsStatus === "real";
  }

  if (
    op.type === "edit" &&
    op.entityType === "section" &&
    op.field === "slug"
  ) {
    const leaf = findLeafData(ctx.root, "section", op.id);
    return leaf?.real === true;
  }

  if (op.type === "delete" && op.entityType === "lesson") {
    const leaf = findLeafData(ctx.root, "lesson", op.id);
    return leaf?.fsStatus === "real";
  }

  if (op.type === "reorder" && op.entityType === "section") return true;

  if (op.type === "reorder" && op.entityType === "lesson") {
    const sectionId = resolveParentId(ctx.root, ctx.path, "section");
    if (!sectionId) return false;
    const leaf = findLeafData(ctx.root, "section", sectionId);
    return leaf?.real === true;
  }

  if (
    op.type === "add" &&
    op.sub === "unarchive" &&
    op.entityType === "lesson"
  ) {
    return true;
  }

  return false;
}

export function findLeafData(
  root: VfsDirNode,
  entityType: string,
  id: string
): Record<string, unknown> | null {
  const filename =
    entityType === "course"
      ? "course.json"
      : entityType === "section"
        ? "section.json"
        : entityType === "lesson"
          ? "lesson.json"
          : entityType === "video"
            ? "video.json"
            : null;

  if (!filename) return null;

  const result: { found: Record<string, unknown> | null } = { found: null };
  walkDir(root, (node) => {
    if (result.found) return;
    if (node.kind !== "file") return;
    if (node.name !== filename) return;
    if (typeof node.data !== "object" || Array.isArray(node.data)) return;
    const data = node.data as Record<string, unknown>;
    if (data.id === id) result.found = data;
  });
  return result.found;
}

function walkDir(dir: VfsDirNode, visit: (node: VfsNode) => void): void {
  for (const child of dir.children.values()) {
    visit(child);
    if (child.kind === "dir") walkDir(child, visit);
  }
}

export function resolveParentId(
  root: VfsDirNode,
  path: string,
  parentType: "section" | "lesson" | "video"
): string | null {
  const parts = path.split("/").filter(Boolean);
  const dirName =
    parentType === "section"
      ? "sections"
      : parentType === "lesson"
        ? "lessons"
        : "videos";
  const leafName =
    parentType === "section"
      ? "section.json"
      : parentType === "lesson"
        ? "lesson.json"
        : "video.json";

  const idx = parts.indexOf(dirName);
  if (idx < 0 || idx + 1 >= parts.length) return null;
  const entityDirName = parts[idx + 1]!;
  const basePath = "/" + parts.slice(0, idx + 1).join("/");
  return readIdFromLeaf(root, `${basePath}/${entityDirName}/${leafName}`);
}

function readIdFromLeaf(root: VfsDirNode, leafPath: string): string | null {
  const result = lookupPath(root, leafPath);
  if (result.type !== "file") return null;
  const data = result.node.data;
  if (typeof data !== "object" || Array.isArray(data)) return null;
  return (data as Record<string, unknown>).id as string | null;
}

export function resolveTimelineItemType(
  root: VfsDirNode,
  path: string,
  itemId: string
): "clip" | "chapter" | null {
  const parts = path.split("/").filter(Boolean);
  const timelineIdx = parts.indexOf("timeline");
  if (timelineIdx < 0) return null;
  const membersPath =
    "/" + parts.slice(0, timelineIdx + 1).join("/") + "/_members.json";
  const result = lookupPath(root, membersPath);
  if (result.type !== "file" || !Array.isArray(result.node.data)) return null;
  const member = (result.node.data as Array<Record<string, unknown>>).find(
    (m) => m.id === itemId
  );
  return (member?.type as "clip" | "chapter") ?? null;
}
