import fs from "node:fs";
import { createHash } from "node:crypto";
import { DropboxContentHasher } from "@/services/dropbox-content-hash";
import { sidecarPath } from "@/services/export-sha256-sidecar";
import { SOUND_FAKE_EXPORT_DURATION_IN_SECONDS } from "./fake-video-processing";

/**
 * Put an Exported Video on disk the way a finished export leaves one: the
 * bytes, and beside them an Export Digest that records their duration.
 *
 * Writing only the bytes is NOT an already-exported Video. A file whose
 * duration this machine has never recorded is one it cannot vouch for, so the
 * export step visits it and measures it — which is how a truncation made
 * before anything checked gets found and repaired. A test that means "this
 * Video needs no encoding" has to say so with both files.
 */
export const writeAlreadyExportedVideo = (
  exportPath: string,
  contents: string
): void => {
  const bytes = Buffer.from(contents);
  fs.writeFileSync(exportPath, bytes);

  const contentHasher = new DropboxContentHasher();
  contentHasher.update(bytes);
  fs.writeFileSync(
    sidecarPath(exportPath),
    JSON.stringify({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentHash: contentHasher.digest(),
      bytes: bytes.length,
      durationInSeconds: SOUND_FAKE_EXPORT_DURATION_IN_SECONDS,
    })
  );
};
