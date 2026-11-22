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
 *
 * The face is also written into the document's meta, so that moving or
 * retaking it is an undo step with the drawing (`thumbnail-face-history.ts`):
 * the page records face changes through `historyRef`, and hears back the
 * face an undo or redo restores.
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
  useEditor,
  useValue,
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
import { goToUrl } from "@/features/diagrams/palette/go-to-url";
import { toast } from "@/components/ui/toast";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  TLDRAW_DARK_BACKGROUND,
  scaledLayerBox,
} from "./canvas-compositor";
import { darkPanelSpan, type DarkPanelSpan } from "./dark-panel";
import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";
import { withoutFace, type ThumbnailFace } from "./thumbnail-face";
import {
  attachFaceHistory,
  type ThumbnailEditorHistory,
} from "./thumbnail-face-history";
import type { ThumbnailDiagramSource } from "@cvm/core/lib/thumbnail-diagram-sources";
import { after } from "@/packages/clock";

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
 * Where each insert came from is the component's to report (see below).
 */
const PALETTE_HANDLERS: Omit<PaletteHandlers, "onInsertSource"> = {
  diagram: null,
  keysFrom: "canvas",
  onGoToDiagram: (target) => {
    // Leaving the page would leave the Thumbnail: a Diagram opens in the
    // playground beside it, and another Thumbnail in a creator beside it.
    window.open(goToUrl(target), "_blank", "noopener");
  },
};

type FaceView = {
  photo: string;
  cutout: string | null;
  position: number;
  ghost: boolean;
};

const FaceContext = createContext<FaceView | null>(null);

/**
 * Whether the Thumbnail Diagram has its dark panel: on unless turned off.
 * The setting is part of the drawing (its document record's meta), so it is
 * saved, loaded and undone with it.
 */
const DARK_PANEL_META_KEY = "thumbnailDarkPanel";

function isDarkPanelOn(editor: Editor): boolean {
  return editor.getDocumentSettings().meta[DARK_PANEL_META_KEY] !== false;
}

function setDarkPanelOn(editor: Editor, on: boolean) {
  const document = editor.getDocumentSettings();
  editor.markHistoryStoppingPoint("dark panel");
  // Written as a store change, not updateDocumentSettings (which skips the
  // history): it is an edit of the drawing, so it is undone and saved.
  editor.store.put([
    { ...document, meta: { ...document.meta, [DARK_PANEL_META_KEY]: on } },
  ]);
}

/** The dark panel the drawing sits on now; null when off or nothing is in the frame. */
function currentDarkPanel(editor: Editor): DarkPanelSpan | null {
  if (!isDarkPanelOn(editor)) return null;
  const topLevel = editor.getSortedChildIdsForParent(editor.getCurrentPageId());
  return darkPanelSpan(
    topLevel.flatMap((id) => editor.getShapePageBounds(id) ?? [])
  );
}

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
  const editor = useEditor();
  const panel = useValue("dark panel", () => currentDarkPanel(editor), [
    editor,
  ]);
  return (
    <div
      className="tl-background"
      style={{ background: TLDRAW_DARK_BACKGROUND, overflow: "hidden" }}
    >
      {face && <FaceLayer src={face.photo} position={face.position} />}
      {panel && (
        <div
          data-testid="dark-panel"
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            left: pct(panel.x),
            width: pct(panel.width),
            background: TLDRAW_DARK_BACKGROUND,
          }}
        />
      )}
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

/**
 * The drawing on its dark panel, as a 1280×720 PNG that is transparent
 * outside the panel; null when the drawing is empty.
 */
async function renderDrawing(editor: Editor): Promise<string | null> {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return null;
  const panel = currentDarkPanel(editor);
  const { blob } = await editor.toImage(ids, {
    bounds: FRAME,
    background: false,
    padding: 0,
    pixelRatio: 1,
    format: "png",
  });
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the drawing");
  if (panel) {
    ctx.fillStyle = TLDRAW_DARK_BACKGROUND;
    ctx.fillRect(panel.x, 0, panel.width, CANVAS_HEIGHT);
  }
  ctx.drawImage(await createImageBitmap(blob), 0, 0);
  return canvas.toDataURL("image/png");
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
  onFaceRestored,
  historyRef,
  onInsertSource,
  children,
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
  /** The editor's undo or redo put the face back to this. */
  onFaceRestored: (face: ThumbnailFace) => void;
  /** Set while the editor is mounted: face changes go on its history here. */
  historyRef: React.RefObject<ThumbnailEditorHistory | null>;
  /** A palette insert landed: where it came from (ADR 0060). */
  onInsertSource: (source: ThumbnailDiagramSource) => void;
  /** The host's controls, directly under the frame (the face slider). */
  children: React.ReactNode;
}) {
  const [hovering, setHovering] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const darkPanelOn = useValue(
    "dark panel on",
    () => (editor ? isDarkPanelOn(editor) : true),
    [editor]
  );
  const callbacks = useRef({
    onDrawingChanged,
    onDrawingRendered,
    onFaceRestored,
    onInsertSource,
  });
  callbacks.current = {
    onDrawingChanged,
    onDrawingRendered,
    onFaceRestored,
    onInsertSource,
  };
  const paletteHandlers = useMemo<PaletteHandlers>(
    () => ({
      ...PALETTE_HANDLERS,
      onInsertSource: (source) => callbacks.current.onInsertSource(source),
    }),
    []
  );
  const initial = useRef(initialDocument);
  // The face the editor opens with: read on mount, like the drawing.
  const initialFace = useRef<ThumbnailFace>({
    photo,
    cutout,
    horizontalPosition: facePosition,
  });
  initialFace.current = { photo, cutout, horizontalPosition: facePosition };

  const handleMount = useCallback(
    (editor: Editor) => {
      if (initial.current) {
        loadSnapshot(editor.store, {
          // Written by this editor's own getSnapshot, as a tldraw document.
          document: initial.current as TLStoreSnapshot,
        });
      }
      const faceHistory = attachFaceHistory(
        editor,
        initialFace.current,
        (face) => callbacks.current.onFaceRestored(face)
      );
      historyRef.current = faceHistory.history;
      editor.clearHistory();
      setEditor(editor);

      let disposed = false;
      let seq = 0;
      let timer: (() => void) | undefined;
      // A store change is not an edit: the load above reaches the listener a
      // frame later as a "user" change (see head-autosaver.ts). Only a document
      // that differs from the last one seen is, and the face in its meta is
      // not the drawing.
      const drawingNow = () =>
        JSON.stringify(withoutFace(getSnapshot(editor.store).document));
      let seen = drawingNow();

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
          timer?.();
          timer = after(DRAWING_SETTLE_MS, () => {
            const now = drawingNow();
            if (now === seen) return;
            seen = now;
            void report(true);
          });
        },
        { scope: "document", source: "user" }
      );

      // Pending edits die with the editor: they belong to the Thumbnail being
      // left, not to the one opened next.
      return () => {
        setEditor(null);
        disposed = true;
        timer?.();
        unlisten();
        faceHistory.dispose();
        if (historyRef.current === faceHistory.history)
          historyRef.current = null;
      };
    },
    [historyRef]
  );

  const face = useMemo(
    () => ({ photo, cutout, position: facePosition, ghost: hovering }),
    [photo, cutout, facePosition, hovering]
  );

  return (
    <>
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg border"
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        <PlaygroundStatusProvider value={STATUS}>
          <FaceContext.Provider value={face}>
            <DiagramEditor
              onMount={handleMount}
              paletteHandlers={paletteHandlers}
              cameraOptions={CAMERA}
              components={COMPONENTS}
            />
          </FaceContext.Provider>
        </PlaygroundStatusProvider>
      </div>
      {children}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={darkPanelOn}
          disabled={!editor}
          onChange={(e) => {
            if (editor) setDarkPanelOn(editor, e.target.checked);
          }}
        />
        Dark panel behind the drawing
      </label>
    </>
  );
}
