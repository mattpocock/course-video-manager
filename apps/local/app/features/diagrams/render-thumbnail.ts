import type { Editor, TLShapeId } from "tldraw";

/**
 * What a thumbnail frames: the whole page (snapshot preservation) or an
 * explicit set of shapes (component capture, which must show the saved
 * selection rather than everything around it).
 *
 * Spelled out at every call site rather than defaulted, because the two mean
 * materially different pictures and an omitted argument would silently pick one.
 */
export type ThumbnailSubject = "current-page" | readonly TLShapeId[];

/**
 * Render a PNG thumbnail, base64-encoded, from the editor.
 *
 * Returns `null` when there is nothing to render.
 */
export async function renderThumbnailPngBase64(
  editor: Editor,
  subject: ThumbnailSubject
): Promise<string | null> {
  const ids =
    subject === "current-page"
      ? Array.from(editor.getCurrentPageShapeIds())
      : Array.from(subject);
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
