import { ThumbnailDiagramEditor } from "./thumbnail-diagram-editor";
import type { ThumbnailEditorHistory } from "./thumbnail-face-history";
import type { thumbnailStateReducer } from "./thumbnail-state-reducer";

/**
 * A Thumbnail with a Thumbnail Diagram: the editor at the largest 16:9 frame
 * the page allows, and the face slider under it, as wide as the frame.
 */
export function ThumbnailDrawingFrame({
  state,
  photo,
  dispatch,
  historyRef,
}: {
  state: thumbnailStateReducer.State;
  /** The face is captured first: there is no frame without it. */
  photo: string;
  dispatch: (action: thumbnailStateReducer.Action) => void;
  /** The editor's undo history, which the face is on too. */
  historyRef: React.RefObject<ThumbnailEditorHistory | null>;
}) {
  return (
    // As wide as the column, but never taller than the window leaves room for.
    <div
      className="flex w-full flex-col gap-2"
      style={{ maxWidth: "calc((100dvh - 14rem) * 16 / 9)" }}
    >
      <ThumbnailDiagramEditor
        key={state.diagramSession}
        initialDocument={state.thumbnailDiagram}
        photo={photo}
        cutout={state.cutoutImage}
        facePosition={state.cutoutPosition}
        onDrawingChanged={(document, image) =>
          dispatch({ type: "drawing-changed", document, image })
        }
        onDrawingRendered={(image) =>
          dispatch({ type: "drawing-rendered", image })
        }
        onFaceRestored={(face) => dispatch({ type: "face-restored", face })}
        historyRef={historyRef}
      >
        {/* The whole frame's width: a fraction of the old slider's travel per pixel. */}
        <input
          type="range"
          aria-label="Face position"
          min={0}
          max={100}
          step={0.05}
          value={state.cutoutPosition}
          onChange={(e) =>
            dispatch({
              type: "cutout-position-changed",
              value: Number(e.target.value),
            })
          }
          // One drag is one undo step.
          onPointerDown={() => dispatch({ type: "face-slide-started" })}
          onPointerUp={() => dispatch({ type: "face-slide-ended" })}
          onPointerCancel={() => dispatch({ type: "face-slide-ended" })}
          onKeyDown={(e) => {
            // Cmd+Z / Cmd+Shift+Z here is the editor's one history too.
            // While the editor counts as focused, tldraw's own shortcut (on
            // <body>, below React's root on the document) has already run it
            // and prevented the default; otherwise the slider forwards it.
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
              if (e.defaultPrevented) return;
              e.preventDefault();
              if (e.shiftKey) historyRef.current?.redo();
              else historyRef.current?.undo();
              return;
            }
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            dispatch({
              type: "face-nudged",
              direction: e.key === "ArrowLeft" ? -1 : 1,
              big: e.shiftKey,
            });
          }}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Draw in the frame. Slide the face, or focus the slider and use ←/→
          (Shift for bigger steps). Cmd+Z undoes face moves with the drawing.
          Cmd+K opens the diagram palette while the canvas has focus.
        </p>
      </ThumbnailDiagramEditor>
    </div>
  );
}
