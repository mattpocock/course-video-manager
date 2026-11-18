import { useCallback, useRef, type ReactNode } from "react";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { CVM_SHAPE_UTILS } from "./cvm-shape-utils";
import { useTldrawLicenseKey } from "./use-tldraw-license-key";
import { DiagramEditorBoundary } from "./unknown-shape-boundary";
import { usePlaygroundStatus } from "./playground-status";
import { CommandPalette } from "./palette/command-palette";
import type { PaletteHandlers } from "./palette/use-palette";

const EMPTY_MIME_TYPES: string[] = [];

const EMPTY_EMBEDS: never[] = [];

const UNSUPPORTED_CONTENT =
  "Images, videos, and embeds aren't supported. Only vector shapes and text are allowed.";

/**
 * The Diagram Editor: the one tldraw setup every CVM diagram surface mounts,
 * so the Diagram Playground and the thumbnail editor are the same editor, not
 * lookalikes (ADR 0060). It owns tldraw's configuration (dark, CVM's custom
 * shapes, the licence key), the vector-and-text-only rule (no image, video or
 * embed shape, and a pasted or dropped file is refused), and the Cmd+K / Cmd+F
 * command palette with its Icons, Diagram Components and diagram search.
 *
 * The host keeps everything else: its camera and persistence (through
 * `onMount`), and every palette action that acts on something only the host
 * knows about, such as a Diagram's snapshots (`paletteHandlers`).
 *
 * Must render inside a `PlaygroundStatusProvider`: refusals and palette errors
 * are reported there.
 */
export function DiagramEditor({
  onMount,
  paletteHandlers,
  children,
}: {
  /** The host attaches its camera and persistence to the editor here. */
  onMount: (editor: Editor) => void;
  /** The host's palette actions; null mounts no palette. */
  paletteHandlers: PaletteHandlers | null;
  /** Host chrome drawn over the canvas, inside the shape-error boundary. */
  children?: ReactNode;
}) {
  const licenseKey = useTldrawLicenseKey();
  const status = usePlaygroundStatus();
  const editorRef = useRef<Editor | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      // A pasted or dropped file would only ever become an image or video,
      // and tldraw's own answer is a toast of its own: say it here instead.
      editor.registerExternalContentHandler("files", () => {
        status.reportError(UNSUPPORTED_CONTENT);
      });
      editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
        if (
          shape.type === "image" ||
          shape.type === "video" ||
          shape.type === "embed"
        ) {
          status.reportError(UNSUPPORTED_CONTENT);
          return undefined as never;
        }
        return shape;
      });

      onMount(editor);
    },
    [onMount, status]
  );

  return (
    <>
      <DiagramEditorBoundary>
        <Tldraw
          licenseKey={licenseKey}
          onMount={handleMount}
          colorScheme="dark"
          acceptedImageMimeTypes={EMPTY_MIME_TYPES}
          acceptedVideoMimeTypes={EMPTY_MIME_TYPES}
          embeds={EMPTY_EMBEDS}
          shapeUtils={CVM_SHAPE_UTILS}
        />
        {children}
      </DiagramEditorBoundary>
      {paletteHandlers && (
        <CommandPalette editorRef={editorRef} handlers={paletteHandlers} />
      )}
    </>
  );
}
