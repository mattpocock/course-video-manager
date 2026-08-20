import { useEffect, useState, type RefObject } from "react";
import { useValue, type Editor } from "tldraw";
import { SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { centreCameraOnContent } from "./centre-camera-on-content";
import {
  getRightOffscreenWidth,
  getSafeAreaInsets,
  useCenteringSetting,
} from "./diagram-centering-settings";

/**
 * A prototype tuning UI (see `docs/adr` — none written yet on purpose: this
 * is deliberately a debug tool, not a finished setting screen). It's how the
 * three numbers `centreCameraOnContent` reads get found in the first place:
 * open it, drag the values until the guide boxes and the diagram look right
 * against your actual camera setup, close it. Nothing here needs to be
 * pretty — it needs to be legible enough to tune live while sat in frame.
 *
 * Deliberately independent of Focus Mode: Focus Mode hides the Snapshot
 * Timeline / Diagram Rail panel on the right, and tuning has to work with
 * that panel either shown or hidden (it changes the usable canvas width), so
 * this is mounted as a sibling of that panel, not nested inside its
 * `!isFocusMode` conditional, and gated on its own open/closed state.
 */
export function DiagramCenteringDebug({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const [open, setOpen] = useState(false);
  const [faceCamWidth, setFaceCamWidth] = useCenteringSetting("faceCamWidth");
  const [paddingX, setPaddingX] = useCenteringSetting("paddingX");
  const [paddingY, setPaddingY] = useCenteringSetting("paddingY");
  // Same insets `centreCameraOnContent` computes the camera move from — the
  // guide boxes below render them directly as CSS, so they can't drift from
  // where the diagram actually lands. Read fresh on every render (rather than
  // cached in state) so a sidebar/Focus Mode toggle — which re-renders this
  // component as a side effect of its parent's own re-render — recomputes it
  // too; see `getRightOffscreenWidth` for why the sidebar matters here at all.
  const viewport = editorRef.current?.getViewportScreenBounds();
  const windowWidth =
    typeof window !== "undefined"
      ? window.innerWidth
      : (viewport?.x ?? 0) + (viewport?.w ?? 0);
  const rightOffscreen = viewport
    ? getRightOffscreenWidth(viewport, windowWidth)
    : 0;
  const insets = getSafeAreaInsets(
    { faceCamWidth, paddingX, paddingY },
    rightOffscreen
  );

  // Live-update: every persisted change re-runs the same recentre the rest
  // of the app uses, so the debug panel never drifts from real behaviour.
  useEffect(() => {
    const ed = editorRef.current;
    if (ed) centreCameraOnContent(ed);
  }, [faceCamWidth, paddingX, paddingY, editorRef]);

  // centreCameraOnContent has no ceiling of its own any more — past the
  // padded edges, the only thing stopping a small diagram from zooming in
  // arbitrarily far is the camera's own `zoomSteps` range (see its history).
  // Nothing here picks a saner cap yet; this is how "how far does it
  // actually go" gets watched live while tuning, the same way the guide
  // boxes above are, before that number gets chosen.
  //
  // `[editorRef.current]` (not `[editorRef]`) is deliberate: `useValue`
  // builds its reactive subscription once per identity in the deps array,
  // and the ref OBJECT never changes, only what it points at. Keying on the
  // object would leave this watching a `computed` built before the editor
  // ever mounted, permanently stuck reading `null` off a signal it never
  // wired up.
  const zoom = useValue(
    "centering-debug-zoom",
    () => editorRef.current?.getZoomLevel() ?? null,
    [editorRef.current]
  );

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Diagram centering debug mode"
        aria-label="Toggle diagram centering debug mode"
        aria-pressed={open}
        className={
          "absolute bottom-40 right-2 z-50 flex h-9 w-9 items-center justify-center rounded-full shadow hover:bg-zinc-600 " +
          (open ? "bg-sky-600 text-white" : "bg-zinc-700 text-zinc-100")
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          {/* Reserved face-cam strip — a full-height zone on the right the
              diagram is kept clear of. Drawn at whatever's left of it after
              the sidebar's own width: the strip is pinned to the window's
              edge, so a sidebar wide enough to cover it needs no red shown
              here at all. */}
          <div
            className="pointer-events-none absolute right-0 top-0 z-40 h-full border-l-2 border-red-500/70 bg-red-500/10"
            style={{ width: Math.max(faceCamWidth - rightOffscreen, 0) }}
          />
          {/* The padded safe rect the diagram is actually fit-and-centred
              into — the same `getSafeAreaInsets` `centreCameraOnContent`
              uses, rendered directly as CSS insets. */}
          <div
            className="pointer-events-none absolute z-40 border-2 border-dashed border-sky-400/70"
            style={{
              left: Math.max(insets.left, 0),
              right: Math.max(insets.right, 0),
              top: Math.max(insets.top, 0),
              bottom: Math.max(insets.bottom, 0),
            }}
          />

          <div className="absolute bottom-52 right-2 z-50 w-56 rounded-md border border-zinc-700 bg-zinc-900/95 p-3 shadow-lg">
            <div className="mb-2 text-xs font-semibold text-zinc-300">
              Diagram centering (debug)
            </div>
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
              <span>Zoom</span>
              <span className="font-mono text-zinc-100">
                {zoom === null ? "—" : `${Math.round(zoom * 100)}%`}
              </span>
            </div>
            <NumberField
              label="Face-cam width"
              value={faceCamWidth}
              onChange={setFaceCamWidth}
            />
            <NumberField
              label="Padding X"
              value={paddingX}
              onChange={setPaddingX}
            />
            <NumberField
              label="Padding Y"
              value={paddingY}
              onChange={setPaddingY}
            />
          </div>
        </>
      )}
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-400 last:mb-0">
      <span>{label}</span>
      <Input
        type="number"
        step={4}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-7 w-20 px-2 text-right text-xs"
      />
    </label>
  );
}
