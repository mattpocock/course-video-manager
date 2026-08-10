/**
 * Pure string transformation functions for ChooseScreenshot message mutation.
 * These operate on the raw message text to replace or update ChooseScreenshot tags.
 */

/**
 * Replace a specific ChooseScreenshot tag with a markdown image link.
 * Matches by clipIndex and alt text to identify the correct tag when
 * multiple exist in the same message.
 */
export function replaceChooseScreenshotWithImage(
  message: string,
  clipIndex: number,
  alt: string,
  imagePath: string
): string {
  const pattern = new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${clipIndex}\\}\\s+alt="${escapeRegex(alt)}"\\s*/>`,
    "g"
  );
  return message.replace(pattern, `![${alt}](${imagePath})`);
}

/**
 * Update the clipIndex in a specific ChooseScreenshot tag.
 * Identifies the tag by its current clipIndex and alt text.
 */
export function updateChooseScreenshotClipIndex(
  message: string,
  currentClipIndex: number,
  newClipIndex: number,
  alt: string
): string {
  const pattern = new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${currentClipIndex}\\}\\s+alt="${escapeRegex(alt)}"\\s*/>`,
    "g"
  );
  return message.replace(
    pattern,
    `<ChooseScreenshot clipIndex={${newClipIndex}} alt="${alt}" />`
  );
}

/**
 * Check if a message contains any unresolved ChooseScreenshot tags.
 * Uses a fresh regex (no /g flag) to avoid stateful lastIndex issues.
 */
export function hasUnresolvedScreenshots(message: string): boolean {
  return /<ChooseScreenshot\s+clipIndex=\{(\d+)\}\s+alt="([^"]*)"\s*\/>/.test(
    message
  );
}

/**
 * Remove a specific ChooseScreenshot tag and up to two trailing newlines.
 * Matches by clipIndex and alt text.
 */
export function removeChooseScreenshot(
  message: string,
  clipIndex: number,
  alt: string
): string {
  const pattern = new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${clipIndex}\\}\\s+alt="${escapeRegex(alt)}"\\s*/>\n{0,2}`,
    "g"
  );
  return message.replace(pattern, "");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
