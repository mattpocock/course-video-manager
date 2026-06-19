import { createHash } from "node:crypto";
import { z } from "zod";
import type { DocumentEdit } from "@/features/article-writer/document-editing-engine";
import type { VfsDirNode } from "./vfs-tree";

export type EntityType =
  | "course"
  | "section"
  | "lesson"
  | "video"
  | "segment"
  | "clip"
  | "chapter";

export type ManifestEntityType =
  | "section"
  | "lesson"
  | "video"
  | "timeline"
  | "segment";

type Capability = {
  add: boolean | "ghost" | "copy-only";
  delete: boolean | "empty-only";
  reorder: boolean;
  editableFields: readonly string[];
};

export const CAPABILITY_MATRIX: Record<EntityType, Capability> = {
  course: { add: false, delete: false, reorder: false, editableFields: [] },
  section: {
    add: "ghost",
    delete: "empty-only",
    reorder: true,
    editableFields: ["description", "slug"],
  },
  lesson: {
    add: "ghost",
    delete: true,
    reorder: true,
    editableFields: [
      "title",
      "slug",
      "description",
      "icon",
      "priority",
      "dependencies",
      "authoringStatus",
      "fsStatus",
    ],
  },
  video: { add: true, delete: true, reorder: true, editableFields: ["name"] },
  segment: {
    add: true,
    delete: true,
    reorder: true,
    editableFields: ["kind", "title", "description"],
  },
  chapter: { add: true, delete: true, reorder: true, editableFields: ["name"] },
  clip: {
    add: "copy-only",
    delete: true,
    reorder: true,
    editableFields: ["text"],
  },
};

export type AddOp = {
  type: "add";
  sub: "create" | "unarchive" | "copy";
  entityType: EntityType;
  target: string;
  id?: string;
  detail: {
    sourceParent?: string;
    footageMatch?: {
      videoFilename: string;
      sourceStartTime: number;
      sourceEndTime: number;
    };
    values?: Record<string, unknown>;
  };
};

export type DeleteOp = {
  type: "delete";
  entityType: EntityType;
  target: string;
  id: string;
};

export type EditFieldOp = {
  type: "edit";
  entityType: EntityType;
  target: string;
  id: string;
  field: string;
  before: unknown;
  after: unknown;
};

export type ReorderOp = {
  type: "reorder";
  entityType: EntityType;
  target: string;
  order: Array<{
    id: string;
    label: string;
    fromIndex: number;
    toIndex: number;
  }>;
};

export type Op = AddOp | DeleteOp | EditFieldOp | ReorderOp;

export type RejectionKind =
  | "not-read"
  | "stale"
  | "forbidden-op"
  | "identity-error"
  | "non-empty-section"
  | "invalid-file"
  | "parse-error"
  | "edit-error";

export type Rejection = { kind: RejectionKind; message: string };

export type WriteInput = { path: string; content: string };
export type EditInput = { path: string; edits: DocumentEdit[] };
export type DiffInput = WriteInput | EditInput;

export type DiffResult =
  | { ok: true; ops: Op[]; note?: string }
  | { ok: false; rejection: Rejection };

export type ArchivedEntity = { entityType: EntityType; parentLabel: string };

export type DiffContext = {
  root: VfsDirNode;
  archived: Map<string, ArchivedEntity>;
};

export type CatStamp = { content: string; path: string; hash: string };

export type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
};

export type DiffMessagePart =
  | ToolResultPart
  | { type: string; [key: string]: unknown };

export type DiffMessage = {
  role: string;
  content: DiffMessagePart[] | string;
};

export type FileType =
  | { kind: "manifest"; entityType: ManifestEntityType }
  | { kind: "leaf"; entityType: EntityType };

// ---------------------------------------------------------------------------
// Write-parse schemas (id nullable for new items)
// ---------------------------------------------------------------------------

export const MANIFEST_SCHEMAS: Record<
  ManifestEntityType,
  z.ZodType<Array<{ id?: string | null; [k: string]: unknown }>>
> = {
  section: z.array(z.object({ id: z.string().nullish(), slug: z.string() })),
  lesson: z.array(
    z.object({
      id: z.string().nullish(),
      slug: z.string(),
      title: z.string(),
    })
  ),
  video: z.array(z.object({ id: z.string().nullish(), name: z.string() })),
  timeline: z.array(
    z.object({
      id: z.string().nullish(),
      type: z.enum(["clip", "chapter"]),
      label: z.string(),
      videoFilename: z.string().optional(),
      sourceStartTime: z.number().optional(),
      sourceEndTime: z.number().optional(),
    })
  ),
  segment: z.array(
    z.object({
      id: z.string().nullish(),
      kind: z.string(),
      title: z.string(),
    })
  ),
};

// ---------------------------------------------------------------------------
// File type resolution + content hashing
// ---------------------------------------------------------------------------

export function resolveFileType(path: string): FileType | null {
  const parts = path.split("/").filter(Boolean);
  const filename = parts[parts.length - 1];
  if (!filename) return null;

  if (filename === "_members.json") {
    const parentDir = parts[parts.length - 2];
    if (parentDir === "sections")
      return { kind: "manifest", entityType: "section" };
    if (parentDir === "lessons")
      return { kind: "manifest", entityType: "lesson" };
    if (parentDir === "videos")
      return { kind: "manifest", entityType: "video" };
    if (parentDir === "timeline")
      return { kind: "manifest", entityType: "timeline" };
    if (parentDir === "segments")
      return { kind: "manifest", entityType: "segment" };
    return null;
  }

  if (filename === "course.json") return { kind: "leaf", entityType: "course" };
  if (filename === "section.json")
    return { kind: "leaf", entityType: "section" };
  if (filename === "lesson.json") return { kind: "leaf", entityType: "lesson" };
  if (filename === "video.json") return { kind: "leaf", entityType: "video" };
  if (filename.endsWith(".clip.json"))
    return { kind: "leaf", entityType: "clip" };
  if (filename.endsWith(".chapter.json"))
    return { kind: "leaf", entityType: "chapter" };

  if (
    parts.length >= 2 &&
    parts[parts.length - 2] === "segments" &&
    filename.endsWith(".json")
  ) {
    return { kind: "leaf", entityType: "segment" };
  }

  return null;
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
