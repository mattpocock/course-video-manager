/**
 * Where a Thumbnail Diagram's inserted shapes came from (ADR 0060: the model
 * is not lossy). A Diagram's head is never a source: inserting it first pins
 * it as an unpreserved DiagramSnapshot, and the snapshot is recorded. Shapes
 * pasted through tldraw's clipboard record nothing, deliberately.
 */
export type ThumbnailDiagramSource =
  | { kind: "diagram-component"; diagramComponentId: string }
  | { kind: "diagram-snapshot"; diagramSnapshotId: string }
  /** Another Thumbnail's drawing, or the original a copied Video's came from. */
  | { kind: "thumbnail-diagram"; thumbnailId: string };

const ID_FIELD = {
  "diagram-component": "diagramComponentId",
  "diagram-snapshot": "diagramSnapshotId",
  "thumbnail-diagram": "thumbnailId",
} as const satisfies Record<ThumbnailDiagramSource["kind"], string>;

const isKind = (kind: unknown): kind is ThumbnailDiagramSource["kind"] =>
  typeof kind === "string" && Object.hasOwn(ID_FIELD, kind);

const readSource = (value: unknown): ThumbnailDiagramSource | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind } = value as { kind?: unknown };
  if (!isKind(kind)) return undefined;
  const field = ID_FIELD[kind];
  const id = (value as Record<string, unknown>)[field];
  if (typeof id !== "string" || id === "") return undefined;
  return { kind, [field]: id } as ThumbnailDiagramSource;
};

/**
 * Reads the `diagramSources` field the thumbnail page saves. A missing field
 * records nothing; anything that isn't a list of sources is a malformed
 * request (undefined), so the route answers 400.
 */
export function readThumbnailDiagramSources(
  value: unknown
): ThumbnailDiagramSource[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const sources: ThumbnailDiagramSource[] = [];
  for (const item of value) {
    const source = readSource(item);
    if (!source) return undefined;
    sources.push(source);
  }
  return sources;
}

const keyOf = (source: ThumbnailDiagramSource) =>
  `${source.kind}:${source[ID_FIELD[source.kind] as keyof typeof source]}`;

/**
 * `recorded` with every source in `incoming` it doesn't hold yet, each once,
 * in the order first recorded. A source is never dropped: undoing an insert,
 * or deleting its shapes, leaves the record (the link is never lost).
 */
export function mergeThumbnailDiagramSources(
  recorded: readonly ThumbnailDiagramSource[],
  incoming: readonly ThumbnailDiagramSource[]
): ThumbnailDiagramSource[] {
  const seen = new Set<string>();
  const merged: ThumbnailDiagramSource[] = [];
  for (const source of [...recorded, ...incoming]) {
    const key = keyOf(source);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged;
}

/**
 * What a copy of `original` (Submit, Duplicate Course, Duplicate Video) records: the
 * original's sources, then the original itself. A Thumbnail with no
 * Thumbnail Diagram (an old pasted PNG) has no drawing to come from.
 */
export function sourcesOfCopiedThumbnail(original: {
  id: string;
  thumbnailDiagram: unknown;
  diagramSources: readonly ThumbnailDiagramSource[];
}): ThumbnailDiagramSource[] {
  if (original.thumbnailDiagram == null) return [...original.diagramSources];
  return mergeThumbnailDiagramSources(original.diagramSources, [
    { kind: "thumbnail-diagram", thumbnailId: original.id },
  ]);
}
