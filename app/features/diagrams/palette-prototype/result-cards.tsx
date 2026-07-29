// PROTOTYPE — throwaway. Result cards for the diagram and component pages.
//
// Deliberately mirrors app/routes/diagram-playground._index.tsx: real
// thumbnail (via /api/diagram-thumbnails/:diagramId/:contentHash), the diagram
// name overlaid bottom-right on the thumbnail, and a two-line snippet of the
// matched search text underneath. Components get the same treatment minus the
// snippet, which they don't have.

import { useState } from "react";
import type { DiagramHit } from "./use-palette-state";
import type { StubComponent } from "./palette-model";

/**
 * Same URL as DiagramThumbnail, but tracks the failure itself. The shared
 * component falls back to an empty div, and because tldraw renders have
 * transparent backgrounds a placeholder sitting *behind* it shows through on
 * every card, not just the broken ones.
 */
function Thumbnail({
  diagramId,
  contentHash,
}: {
  diagramId: string;
  contentHash: string | null;
}) {
  const [failed, setFailed] = useState(false);
  if (!contentHash || failed) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-700">
        no preview
      </span>
    );
  }
  return (
    <img
      src={`/api/diagram-thumbnails/${diagramId}/${contentHash}`}
      alt=""
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  );
}

/**
 * Lifted verbatim from the diagrams root page so the palette shows the same
 * "…10 words around the first match…" text the user already recognises.
 */
export function makeSnippet(searchText: string | null, query: string): string {
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
}: {
  hit: DiagramHit;
  query: string;
}) {
  const snippet = makeSnippet(hit.searchText, query);
  return (
    <>
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-t bg-zinc-950">
        <Thumbnail diagramId={hit.diagramId} contentHash={hit.contentHash} />
        <span className="absolute right-1 bottom-1 max-w-[85%] truncate rounded bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
          {hit.diagramName}
        </span>
      </div>
      {/* Fixed height so a one-line snippet and a two-line one produce cards
          of the same height — grid rows are otherwise ragged. */}
      <p className="line-clamp-2 h-[34px] px-1.5 py-1 text-[10px] leading-snug text-zinc-400">
        {snippet || "—"}
      </p>
    </>
  );
}

export function ComponentCard({ component }: { component: StubComponent }) {
  return (
    <>
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-t bg-zinc-950">
        <img
          src={component.thumbnail}
          alt=""
          className="h-full w-full object-contain p-2"
        />
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] text-zinc-300">
        {component.name}
      </p>
    </>
  );
}
