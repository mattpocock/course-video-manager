import { useMemo, useState } from "react";
import { TldrawImage } from "tldraw";
import "tldraw/tldraw.css";
import { CVM_SHAPE_UTILS } from "@/features/diagrams/cvm-shape-utils";
import { ShapeTypeErrorBoundary } from "@/features/diagrams/unknown-shape-boundary";

export const DiagramThumbnail = (props: {
  diagramId?: string;
  contentHash?: string;
  scene?: unknown;
  className?: string;
  darkMode?: boolean;
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  // `TldrawImage` builds a fresh store, editor and image export whenever its
  // `snapshot` changes identity. A new `{ document }` on every render made each
  // fallback tile re-render its drawing every time the page re-rendered — the
  // Playground revalidates every 2s — so it is kept per drawing: by content
  // hash when there is one (a refetched timeline hands over new objects for
  // the same drawings), else by the scene object itself. A snapshot redrawn in
  // place gets a new hash, so it never shows a stale picture.
  const drawingKey = props.contentHash ?? props.scene;
  const tldrawSnapshot = useMemo(
    () => ({ document: props.scene }) as never,
    [drawingKey]
  );

  const url =
    props.diagramId && props.contentHash
      ? `/api/diagram-thumbnails/${props.diagramId}/${props.contentHash}`
      : null;

  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt=""
        className={props.className}
        onError={() => setImgFailed(true)}
      />
    );
  }

  if (
    props.scene &&
    typeof props.scene === "object" &&
    "store" in props.scene
  ) {
    return (
      // A thumbnail that fails to render leaves a blank tile rather than
      // taking down the page around it — one bad diagram must not break
      // Playground Home.
      <ShapeTypeErrorBoundary fallback={<div className={props.className} />}>
        <div className={props.className}>
          <TldrawImage
            snapshot={tldrawSnapshot}
            darkMode={props.darkMode ?? true}
            background={false}
            // Without the custom shape utils, the first diagram containing an
            // icon would throw right here — this is the fallback path whenever
            // no cached PNG exists.
            shapeUtils={CVM_SHAPE_UTILS}
          />
        </div>
      </ShapeTypeErrorBoundary>
    );
  }

  return <div className={props.className} />;
};
