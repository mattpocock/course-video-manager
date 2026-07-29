import fs from "node:fs";
import path from "node:path";

export function getDiagramThumbnailsBaseDir(): string {
  const dir = process.env.DIAGRAM_THUMBNAILS_DIR;
  if (!dir) {
    throw new Error("DIAGRAM_THUMBNAILS_DIR environment variable is not set");
  }
  return dir;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeSegment(value: string, field: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`Unsafe ${field}: ${value}`);
  }
}

export function getThumbnailPath(
  diagramId: string,
  contentHash: string
): string {
  assertSafeSegment(diagramId, "diagramId");
  assertSafeSegment(contentHash, "contentHash");
  return path.join(
    getDiagramThumbnailsBaseDir(),
    diagramId,
    `${contentHash}.png`
  );
}

export function writeThumbnail(
  diagramId: string,
  contentHash: string,
  png: Buffer
): void {
  const filePath = getThumbnailPath(diagramId, contentHash);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

export function readThumbnail(
  diagramId: string,
  contentHash: string
): Buffer | null {
  const filePath = getThumbnailPath(diagramId, contentHash);
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export function thumbnailExists(
  diagramId: string,
  contentHash: string
): boolean {
  return fs.existsSync(getThumbnailPath(diagramId, contentHash));
}

/**
 * Component thumbnails are keyed by component id, not by content hash:
 * components are immutable so the file never needs invalidating, uniqueness is
 * trivial, and delete is one unlink. Hashing would dedupe identical components
 * but then deleting one would orphan a twin's file.
 *
 * The `_components` prefix cannot collide with a diagram id — UUIDs contain no
 * underscore — and already passes the SAFE_ID guard above.
 */
const COMPONENTS_DIR = "_components";

export function getComponentThumbnailPath(componentId: string): string {
  assertSafeSegment(componentId, "componentId");
  return path.join(
    getDiagramThumbnailsBaseDir(),
    COMPONENTS_DIR,
    `${componentId}.png`
  );
}

export function writeComponentThumbnail(
  componentId: string,
  png: Buffer
): void {
  const filePath = getComponentThumbnailPath(componentId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

export function readComponentThumbnail(componentId: string): Buffer | null {
  try {
    return fs.readFileSync(getComponentThumbnailPath(componentId));
  } catch {
    return null;
  }
}

/**
 * Best-effort: an orphaned file wastes bytes, while a live row pointing at a
 * missing file is a broken tile. Delete order is therefore row first, then
 * this.
 */
export function deleteComponentThumbnail(componentId: string): void {
  try {
    fs.unlinkSync(getComponentThumbnailPath(componentId));
  } catch {
    // Already gone, or never written. Nothing to do.
  }
}
