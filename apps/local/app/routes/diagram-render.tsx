import { useCallback } from "react";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { CVM_SHAPE_UTILS } from "@/features/diagrams/cvm-shape-utils";
import {
  DIAGRAM_RENDER_GLOBAL,
  type DiagramRenderFunction,
} from "@/features/diagrams/diagram-render-contract";
import { renderScenePng } from "@/features/diagrams/render-scene-png";
import { NO_TOASTS } from "@/lib/route-toasts";

/**
 * A bare page that turns a Diagram's scene into a PNG, for `cvm diagram
 * create`. No person opens it: the Clip Mockup daemon's Chromium does, waits
 * for `window.__cvmRenderDiagram`, and calls it with the scene. See
 * features/diagrams/diagram-render-contract.ts.
 *
 * It reads nothing from the database — the scene arrives with the call — so
 * it can draw a Diagram before it has been saved.
 */
export const handle = NO_TOASTS;

const EMPTY_MIME_TYPES: string[] = [];

export default function DiagramRender() {
  const handleMount = useCallback((editor: Editor) => {
    const render: DiagramRenderFunction = (scene) =>
      renderScenePng(editor, scene);
    (window as unknown as Record<string, unknown>)[DIAGRAM_RENDER_GLOBAL] =
      render;
    return () => {
      delete (window as unknown as Record<string, unknown>)[
        DIAGRAM_RENDER_GLOBAL
      ];
    };
  }, []);

  return (
    <div className="fixed inset-0">
      <Tldraw
        onMount={handleMount}
        hideUi
        colorScheme="dark"
        acceptedImageMimeTypes={EMPTY_MIME_TYPES}
        acceptedVideoMimeTypes={EMPTY_MIME_TYPES}
        shapeUtils={CVM_SHAPE_UTILS}
      />
    </div>
  );
}
