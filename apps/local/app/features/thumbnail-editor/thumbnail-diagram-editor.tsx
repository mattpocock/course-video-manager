/**
 * The thumbnail editor: the shared Diagram Editor clipped to the 16:9 frame,
 * with the camera fixed on the 1280×720 Thumbnail (no pan, no zoom), editing
 * the Thumbnail's Thumbnail Diagram in place (ADR 0060).
 *
 * The face is drawn around the canvas, never inside it (the editor stays
 * vector and text only): the background photo is tldraw's Background, behind
 * the shapes, and the Cutout sits in front of them but below tldraw's own UI.
 * The Cutout takes no clicks, and fades to a ghost while the pointer is in
 * the frame, so the author can see and pick the shapes under their face.
 *
 * The page's reducer holds the face and the drawing: this component reports
 * each drawing edit (the document, and the drawing as a PNG for the
 * composite) and never decides whether to save.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLCameraOptions,
  type TLComponents,
  type TLStoreSnapshot,
} from "tldraw";
import { DiagramEditor } from "@/features/diagrams/diagram-editor";
import {
  PlaygroundStatusProvider,
  type PlaygroundStatus,
} from "@/features/diagrams/playground-status";
import type { PaletteHandlers } from "@/features/diagrams/palette/use-palette";
import { highlightedSnapshotUrl } from "@/lib/diagram-protocol";
import { toast } from "@/components/ui/toast";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  TLDRAW_DARK_BACKGROUND,
  scaledLayerBox,
} from "./canvas-compositor";
import type { ThumbnailDiagramDocument } from "./thumbnail-state-reducer";

const FRAME = new Box(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

const CAMERA: Partial<TLCameraOptions> = {
  wheelBehavior: "none",
  zoomSteps: [1],
  constraints: {
    bounds: { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT },
    padding: { x: 0, y: 0 },
    origin: { x: 0.5, y: 0.5 },
    initialZoom: "fit-x",
    baseZoom: "fit-x",
    behavior: "fixed",
  },
};

/** How long the drawing settles before an edit is reported. */
const DRAWING_SETTLE_MS = 150;

/** The Cutout's opacity while the pointer is in the frame. */
const GHOST_OPACITY = 0.35;

/** Errors from the editor (a refused paste, a palette failure) are toasts here. */
const STATUS: PlaygroundStatus = {
  reportError: (message) => toast.error(message),
  reportSuccess: () => {},
};

/**
 * The thumbnail editor has no Diagram of its own, so the palette leaves out
 * every action on one. Cmd/Ctrl+K and +F are the palette's only while the
 * canvas has focus: elsewhere on the page they are Global Search and find.
 */
const PALETTE_HANDLERS: PaletteHandlers = {
  diagram: null,
  keysFrom: "canvas",
  onGoToDiagram: (target) => {
    // Leaving the page would leave the Thumbnail: the playground opens beside it.
    window.open(
      highlightedSnapshotUrl(target.diagramId, target.highlightSnapshotId),
      "_blank",
      "noopener"
    );
  },
};

type FaceView = {
  photo: string;
  cutout: string | null;
  position: number;
  ghost: boolean;
};

const FaceContext = createContext<FaceView | null>(null);

const pct = (n: number) => `${(n / CANVAS_WIDTH) * 100}%`;

/** One face layer, laid out exactly as `composeThumbnailLayers` draws it. */
function FaceLayer({
  src,
  position,
  style,
}: {
  src: string;
  position: number;
  style?: React.CSSProperties;
}) {
  // The layer's width follows its aspect, known only once it has loaded.
  const [aspect, setAspect] = useState<number | null>(null);
  const box = aspect
    ? scaledLayerBox(aspect * CANVAS_HEIGHT, CANVAS_HEIGHT, position)
    : null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={(e) =>
        setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)
      }
      style={{
        position: "absolute",
        top: 0,
        height: "100%",
        maxWidth: "none",
        left: box ? pct(box.x) : 0,
        width: box ? pct(box.width) : "auto",
        visibility: box ? "visible" : "hidden",
        ...style,
      }}
    />
  );
}

function PhotoBackground() {
  const face = useContext(FaceContext);
  return (
    <div
      className="tl-background"
      style={{ background: TLDRAW_DARK_BACKGROUND, overflow: "hidden" }}
    >
      {face && <FaceLayer src={face.photo} position={face.position} />}
    </div>
  );
}

function CutoutInFront() {
  const face = useContext(FaceContext);
  if (!face?.cutout) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <FaceLayer
        src={face.cutout}
        position={face.position}
        style={{
          pointerEvents: "none",
          opacity: face.ghost ? GHOST_OPACITY : 1,
          transition: "opacity 120ms",
        }}
      />
    </div>
  );
}

const COMPONENTS: TLComponents = {
  Background: PhotoBackground,
  InFrontOfTheCanvas: CutoutInFront,
};

/** The drawing alone, as a transparent 1280×720 PNG; null when it is empty. */
async function renderDrawing(editor: Editor): Promise<string | null> {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return null;
  const { blob } = await editor.toImage(ids, {
    bounds: FRAME,
    background: false,
    padding: 0,
    pixelRatio: 1,
    format: "png",
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read the drawing"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Mount it once per Thumbnail (`key` it on the reducer's `diagramSession`):
 * `initialDocument` is read on mount only, so the undo history and the
 * editor survive the page's own saves.
 */
export function ThumbnailDiagramEditor({
  initialDocument,
  photo,
  cutout,
  facePosition,
  onDrawingChanged,
  onDrawingRendered,
}: {
  initialDocument: ThumbnailDiagramDocument | null;
  photo: string;
  cutout: string | null;
  facePosition: number;
  /** The author edited the drawing. */
  onDrawingChanged: (
    document: ThumbnailDiagramDocument,
    image: string | null
  ) => void;
  /** The loaded drawing, drawn for the composite: not an edit. */
  onDrawingRendered: (image: string | null) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const callbacks = useRef({ onDrawingChanged, onDrawingRendered });
  callbacks.current = { onDrawingChanged, onDrawingRendered };
  const initial = useRef(initialDocument);

  const handleMount = useCallback((editor: Editor) => {
    if (initial.current) {
      loadSnapshot(editor.store, {
        // Written by this editor's own getSnapshot, as a tldraw document.
        document: initial.current as TLStoreSnapshot,
      });
    }
    editor.clearHistory();

    let disposed = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A store change is not an edit: the load above reaches the listener a
    // frame later as a "user" change (see head-autosaver.ts). Only a document
    // that differs from the last one seen is.
    let seen = JSON.stringify(getSnapshot(editor.store).document);

    const report = async (edited: boolean) => {
      const mine = ++seq;
      const document = getSnapshot(editor.store).document;
      const image = await renderDrawing(editor).catch(() => null);
      if (disposed || mine !== seq) return;
      if (edited) callbacks.current.onDrawingChanged(document, image);
      else callbacks.current.onDrawingRendered(image);
    };

    void report(false);
    const unlisten = editor.store.listen(
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const now = JSON.stringify(getSnapshot(editor.store).document);
          if (now === seen) return;
          seen = now;
          void report(true);
        }, DRAWING_SETTLE_MS);
      },
      { scope: "document", source: "user" }
    );

    // Pending edits die with the editor: they belong to the Thumbnail being
    // left, not to the one opened next.
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten();
    };
  }, []);

  const face = useMemo(
    () => ({ photo, cutout, position: facePosition, ghost: hovering }),
    [photo, cutout, facePosition, hovering]
  );

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <PlaygroundStatusProvider value={STATUS}>
        <FaceContext.Provider value={face}>
          <DiagramEditor
            onMount={handleMount}
            paletteHandlers={PALETTE_HANDLERS}
            cameraOptions={CAMERA}
            components={COMPONENTS}
          />
        </FaceContext.Provider>
      </PlaygroundStatusProvider>
    </div>
  );
}
