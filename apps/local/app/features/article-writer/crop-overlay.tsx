import { useRef } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { ScreenCrop } from "@/packages/clip-source";
import { cn } from "@/lib/utils";
import {
  CROP_HANDLES,
  createInitialCropState,
  cropReducer,
  shownCrop,
  type CropHandle,
  type CropPoint,
} from "./crop-reducer";

const pct = (n: number) => `${n * 100}%`;

/** Where each handle sits on the box, and the cursor it shows. */
const HANDLE_PLACES: Record<
  CropHandle,
  { left: string; top: string; cursor: string; edge: boolean }
> = {
  nw: { left: "0%", top: "0%", cursor: "nwse-resize", edge: false },
  n: { left: "50%", top: "0%", cursor: "ns-resize", edge: true },
  ne: { left: "100%", top: "0%", cursor: "nesw-resize", edge: false },
  e: { left: "100%", top: "50%", cursor: "ew-resize", edge: true },
  se: { left: "100%", top: "100%", cursor: "nwse-resize", edge: false },
  s: { left: "50%", top: "100%", cursor: "ns-resize", edge: true },
  sw: { left: "0%", top: "100%", cursor: "nesw-resize", edge: false },
  w: { left: "0%", top: "50%", cursor: "ew-resize", edge: true },
};

/**
 * The crop box over Choose Screenshot's screen frame, the rest dimmed, and
 * the Custom Crop's gestures on it (see `crop-reducer.ts`): drag outside the
 * box to draw a new one, inside it to move it, or by one of its eight
 * handles to resize it, with Alt about the centre and Shift on a corner
 * keeping its aspect. A finished gesture is handed to `onSave`, which saves
 * it as Custom.
 */
export function CropOverlay(props: {
  /** The box the placeholder's face cuts to, or null (No face). */
  crop: ScreenCrop | null;
  onSave: (crop: ScreenCrop) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onSaveRef = useRef(props.onSave);
  onSaveRef.current = props.onSave;
  const [state, dispatch] = useEffectReducer(
    cropReducer,
    createInitialCropState,
    {
      "save-custom-crop": (_state, effect) => {
        onSaveRef.current(effect.crop);
      },
    }
  );
  const box = shownCrop(state, props.crop);

  const pointOf = (e: React.PointerEvent): CropPoint | null => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const capture = (e: React.PointerEvent) => {
    if (e.button !== 0) return false;
    e.preventDefault();
    // Keeps the drag's moves and its release coming here once the pointer
    // leaves the frame. A pointer the browser no longer tracks cannot be
    // captured; the gesture still works while it stays over the frame.
    if (rootRef.current?.hasPointerCapture(e.pointerId) === false) {
      try {
        rootRef.current.setPointerCapture(e.pointerId);
      } catch {
        // Not capturable: see above.
      }
    }
    return true;
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 cursor-crosshair touch-none select-none overflow-hidden"
      data-testid="crop-overlay"
      onPointerDown={(e) => {
        const point = pointOf(e);
        if (!point || !capture(e)) return;
        dispatch({ type: "press-frame", point, box: props.crop });
      }}
      onPointerMove={(e) => {
        // Only while a button is held: a hover is not a gesture, and the
        // reducer re-renders on every event it hears.
        if (e.buttons === 0) return;
        const point = pointOf(e);
        if (!point) return;
        dispatch({
          type: "move-pointer",
          point,
          alt: e.altKey,
          shift: e.shiftKey,
        });
      }}
      onPointerUp={() => dispatch({ type: "release-pointer" })}
      onPointerCancel={() => dispatch({ type: "lose-pointer" })}
    >
      {box && (
        <div
          className={cn(
            "absolute border-2 border-primary",
            state.drag?.kind === "move" ? "cursor-grabbing" : "cursor-move"
          )}
          data-testid="diagram-frame-box"
          style={{
            left: pct(box.x),
            top: pct(box.y),
            width: pct(box.w),
            height: pct(box.h),
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
          }}
        >
          {CROP_HANDLES.map((handle) => {
            const place = HANDLE_PLACES[handle];
            return (
              <div
                key={handle}
                data-crop-handle={handle}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 border border-primary bg-background",
                  place.edge ? "size-2" : "size-2.5"
                )}
                style={{
                  left: place.left,
                  top: place.top,
                  cursor: place.cursor,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const point = pointOf(e);
                  if (!point || !props.crop || !capture(e)) return;
                  dispatch({
                    type: "press-handle",
                    handle,
                    point,
                    box: props.crop,
                  });
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
