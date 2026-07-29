import type { Editor, TLShapeId } from "tldraw";

/**
 * Render a PNG thumbnail, base64-encoded, from the editor.
 *
 * Pass `shapeIds` to frame a subset — component capture uses that so the
 * thumbnail shows the saved selection rather than the whole page. Omit it and
 * the whole current page is rendered, which is what snapshot preservation
 * wants.
 *
 * Returns `null` when there is nothing to render.
 */
export async function renderThumbnailPngBase64(
  editor: Editor,
  shapeIds?: readonly TLShapeId[]
): Promise<string | null> {
  const ids = shapeIds
    ? Array.from(shapeIds)
    : Array.from(editor.getCurrentPageShapeIds());
  if (ids.length === 0) return null;

  const { blob } = await editor.toImage(ids, {
    format: "png",
    background: false,
    darkMode: true,
    padding: 32,
  });
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
