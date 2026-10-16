const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
];

/**
 * Whether a Video File is an image, by its extension. A writer prompt sends
 * an image as an image part rather than as text.
 */
export const isImageFilePath = (filePath: string): boolean => {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};
