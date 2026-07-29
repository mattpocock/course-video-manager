import { useState } from "react";
import { makeSnippet } from "@/features/diagrams/make-snippet";
import type { ComponentSummary, DiagramHit } from "./use-palette";

/**
 * Same URL as `DiagramThumbnail`, but tracking the failure itself.
 *
 * The shared component falls back to an empty div, and because tldraw renders
 * have transparent backgrounds a "no preview" placeholder sitting BEHIND it
 * would show through every card, not just the broken ones. It matters here
 * because roughly a fifth of search hits are `source: "current"`, where head
 * state often has no cached render.
 */
function Thumbnail({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-600">
        no preview
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  );
}

/**
 * Mirrors the Playground Home diagrams page: real thumbnail, name overlaid
 * bottom-right, and the same 10-word matched-text snippet. No source badge and
 * no shape count — both were explicitly rejected.
 */
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
        <Thumbnail
          src={
            hit.contentHash
              ? `/api/diagram-thumbnails/${hit.diagramId}/${hit.contentHash}`
              : null
          }
        />
        <span className="absolute right-1 bottom-1 max-w-[85%] truncate rounded bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
          {hit.diagramName}
        </span>
      </div>
      {/* Fixed height, so a one-line snippet and a two-line one make cards of
          the same height — grid rows are otherwise ragged. */}
      <p className="line-clamp-2 h-[34px] px-1.5 py-1 text-[10px] leading-snug text-zinc-400">
        {snippet || "—"}
      </p>
    </>
  );
}

export function ComponentCard({ component }: { component: ComponentSummary }) {
  return (
    <>
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-t bg-zinc-950">
        <Thumbnail src={`/api/diagram-component-thumbnails/${component.id}`} />
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] text-zinc-300">
        {component.name}
      </p>
    </>
  );
}
