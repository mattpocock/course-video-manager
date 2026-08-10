// Writes a tldraw scene document onto the system clipboard in tldraw's
// own clipboard format, so the user can paste it into any tldraw canvas
// via the usual Ctrl/Cmd-V keystroke.
//
// The scene we store is the `document` from `getSnapshot(editor.store)` —
// `{ store: Record<RecordId, TLRecord>, schema: SerializedSchema }`. tldraw's
// paste handler expects a `TLContent` ({ shapes, bindings, assets, rootShapeIds,
// schema }) wrapped in a tagged HTML envelope. We rebuild that from the scene.

import { toast } from "sonner";

interface SerializedRecord {
  typeName: string;
  id: string;
  parentId?: string;
  [key: string]: unknown;
}

interface SceneDocument {
  store: Record<string, SerializedRecord>;
  schema: unknown;
}

function buildTldrawClipboardHtml(scene: SceneDocument): string | null {
  const records = Object.values(scene.store ?? {});
  const shapes = records.filter((r) => r.typeName === "shape");
  if (shapes.length === 0) return null;

  const bindings = records.filter((r) => r.typeName === "binding");
  const assets = records.filter((r) => r.typeName === "asset");

  const shapeIds = new Set(shapes.map((s) => s.id));
  const rootShapeIds = shapes
    .filter((s) => !s.parentId || !shapeIds.has(s.parentId))
    .map((s) => s.id);

  const clipboard = {
    type: "application/tldraw",
    kind: "content",
    version: 2,
    data: {
      shapes,
      bindings,
      assets,
      rootShapeIds,
      schema: scene.schema,
    },
  };

  return `<div data-tldraw>${JSON.stringify(clipboard)}</div>`;
}

/**
 * Copy a STORED diagram — head is fetched from the server rather than read off
 * the editor, so this works for any diagram, not only the open one. Callers
 * that are copying the open diagram must flush its pending save first, or the
 * copy is up to 500ms stale.
 *
 * Every outcome is a toast, because copying has no other visible result.
 */
export async function copyDiagramContents(diagramId: string): Promise<void> {
  try {
    const res = await fetch(`/api/diagrams/${diagramId}/head`);
    if (!res.ok) {
      toast.error("Failed to copy diagram");
      return;
    }
    const data = await res.json();
    if (!data.headScene) {
      toast.error("Diagram is empty");
      return;
    }
    const result = await copySceneToClipboard(data.headScene);
    if (result === "ok") {
      toast.success("Diagram copied — paste into the canvas");
    } else if (result === "empty") {
      toast.error("Diagram has no shapes to copy");
    } else {
      toast.error("Failed to copy diagram");
    }
  } catch {
    toast.error("Failed to copy diagram");
  }
}

export async function copySceneToClipboard(
  scene: unknown
): Promise<"ok" | "empty" | "error"> {
  const html = buildTldrawClipboardHtml(scene as SceneDocument);
  if (!html) return "empty";

  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([" "], { type: "text/plain" }),
        }),
      ]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(html);
    } else {
      return "error";
    }
    return "ok";
  } catch {
    return "error";
  }
}
