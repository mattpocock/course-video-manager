import path from "node:path";

export function getVideoFilesBaseDir(): string {
  return process.env.VIDEO_FILES_DIR || "./video-files";
}

export function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function getVideoFilePath(lineageId: string, filename?: string): string {
  const baseDir = getVideoFilesBaseDir();
  const videoDir = path.join(baseDir, lineageId);

  if (filename) {
    if (isUrl(filename)) {
      return filename;
    }
    return path.join(videoDir, filename);
  }

  return videoDir;
}
