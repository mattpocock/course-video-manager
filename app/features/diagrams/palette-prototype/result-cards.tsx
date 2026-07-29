// PROTOTYPE — throwaway. Shared result cards for the diagram and component
// pages, so all three variants render the same thing at different densities.
//
// Deliberately mirrors app/routes/diagram-playground._index.tsx: real
// thumbnail (via /api/diagram-thumbnails/:diagramId/:contentHash), the diagram
// name overlaid bottom-right on the thumbnail, and a two-line snippet of the
// matched search text underneath. Components get the same treatment minus the
// snippet, which they don't have.

import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import type { DiagramHit } from "./use-palette-state";
import type { StubComponent } from "./palette-model";

/**
 * Lifted verbatim from the diagrams root page so the palette shows the same
 * "…10 words around the first match…" text the user already recognises.
 */
export function makeSnippet(
  searchText: string | null,
  query: string
): string {
  if (!searchText) return "";
  const words = searchText.split(/\s+/);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const idx = words.findIndex((w) =>
    terms.some((t) => w.toLowerCase().includes(t))
  );
  const start = Math.max(0, idx > 0 ? idx - 3 : 0);
  const slice = words.slice(start, start + 10);
  return (
    (start > 0 ? "… " : "") +
    slice.join(" ") +
    (start + 10 < words.length ? " …" : "")
  );
}

export function DiagramCard({
  hit,
  query,
  compact,
}: {
  hit: DiagramHit;
  query: string;
  compact?: boolean;
}) {
  const snippet = makeSnippet(hit.searchText, query);
  return (
    <>
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t bg-zinc-950">
        {/* Sits behind the thumbnail; shows through when the head state has no
            cached render yet (source: "current" often doesn't). */}
        <span className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-700">
          no preview
        </span>
        <DiagramThumbnail
          diagramId={hit.diagramId}
          contentHash={hit.contentHash ?? undefined}
          className="relative h-full w-full object-contain"
        />
        <span className="absolute right-1 bottom-1 max-w-[85%] truncate rounded bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
          {hit.diagramName}
        </span>
        {hit.source === "snapshot" && (
          <span className="absolute top-1 left-1 rounded bg-amber-500/80 px-1 py-px text-[9px] font-medium text-amber-950">
            snapshot
          </span>
        )}
      </div>
      <p
        className={`px-1.5 py-1 leading-snug text-zinc-400 ${
          compact ? "line-clamp-2 text-[10px]" : "line-clamp-2 text-[11px]"
        }`}
      >
        {snippet || "—"}
      </p>
    </>
  );
}

export function ComponentCard({
  component,
  compact,
}: {
  component: StubComponent;
  compact?: boolean;
}) {
  return (
    <>
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t bg-zinc-950">
        <img
          src={component.thumbnail}
          alt=""
          className="h-full w-full object-contain p-2"
        />
        <span className="absolute right-1 bottom-1 rounded bg-zinc-950/85 px-1 py-px text-[9px] text-zinc-400">
          {component.shapeCount} shapes
        </span>
      </div>
      <p
        className={`truncate px-1.5 py-1 text-zinc-300 ${
          compact ? "text-[10px]" : "text-[11px]"
        }`}
      >
        {component.name}
      </p>
    </>
  );
}
