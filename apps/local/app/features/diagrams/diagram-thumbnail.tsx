import { useState } from "react";
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
            snapshot={{ document: props.scene } as never}
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
