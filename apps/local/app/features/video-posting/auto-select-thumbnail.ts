export function getAutoSelectThumbnailId(
  thumbnails: Array<{ id: string }>
): string | null {
  if (thumbnails.length !== 1) return null;
  return thumbnails[0]!.id;
}
