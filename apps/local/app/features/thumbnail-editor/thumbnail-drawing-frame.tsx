import { ThumbnailDiagramEditor } from "./thumbnail-diagram-editor";
import type { thumbnailStateReducer } from "./thumbnail-state-reducer";

/**
 * A Thumbnail with a Thumbnail Diagram: the editor at the largest 16:9 frame
 * the page allows, and the face slider under it, as wide as the frame.
 */
export function ThumbnailDrawingFrame({
  state,
  photo,
  dispatch,
}: {
  state: thumbnailStateReducer.State;
  /** The face is captured first: there is no frame without it. */
  photo: string;
  dispatch: (action: thumbnailStateReducer.Action) => void;
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
        onInsertSource={(source) =>
          dispatch({ type: "insert-source-recorded", source })
        }
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
          onKeyDown={(e) => {
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
          (Shift for bigger steps). Cmd+K opens the diagram palette while the
          canvas has focus.
        </p>
      </ThumbnailDiagramEditor>
    </div>
  );
}
