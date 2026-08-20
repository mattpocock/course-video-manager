import type { Editor } from "tldraw";
import type { Snapshot } from "@/features/diagrams/snapshot-list";
import { CommandPalette } from "./command-palette";
import { usePaletteHandlers } from "./use-palette-handlers";

/**
 * The palette, wired to the Active Diagram window.
 *
 * The route hands over the handlers its own chrome already uses and knows
 * nothing else about the palette — the mirror layer lives in
 * `usePaletteHandlers`, next to the palette rather than next to the canvas.
 */
export function DiagramCommandPalette(props: {
  diagramId: string;
  editorRef: React.RefObject<Editor | null>;
  flushPendingSave: () => Promise<void>;
  preserveSnapshot: () => Promise<void>;
  handleRestoreRequest: (snapshot: Snapshot, headIsCaptured: boolean) => void;
  handleCopyDiagramContents: (id: string) => Promise<void>;
  handleCreateDiagram: () => Promise<void>;
  reloadScene: (id: string) => Promise<void>;
  /** The same camera move the manual Cmd/Ctrl+0 shortcut runs. */
  recentreDiagram: () => void;
}) {
  const handlers = usePaletteHandlers(props);
  return <CommandPalette editorRef={props.editorRef} handlers={handlers} />;
}
