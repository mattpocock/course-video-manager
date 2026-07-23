import { createHash } from "node:crypto";

const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB

/**
 * Compute Dropbox's content_hash for a buffer.
 *
 * Algorithm: split into 4 MB blocks, SHA-256 each block, concatenate
 * the per-block digests, then SHA-256 the concatenation.
 */
export const computeDropboxContentHash = (data: Buffer): string => {
  const blockHashes: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    const block = data.subarray(offset, offset + BLOCK_SIZE);
    blockHashes.push(createHash("sha256").update(block).digest());
  }
  return createHash("sha256").update(Buffer.concat(blockHashes)).digest("hex");
};

/**
 * Incremental Dropbox content_hash builder for streaming use.
 */
export class DropboxContentHasher {
  private blockHashes: Buffer[] = [];
  private currentBlock = createHash("sha256");
  private currentBlockBytes = 0;

  update(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      const remaining = BLOCK_SIZE - this.currentBlockBytes;
      const end = Math.min(offset + remaining, chunk.length);
      this.currentBlock.update(chunk.subarray(offset, end));
      this.currentBlockBytes += end - offset;
      offset = end;

      if (this.currentBlockBytes === BLOCK_SIZE) {
        this.blockHashes.push(this.currentBlock.digest());
        this.currentBlock = createHash("sha256");
        this.currentBlockBytes = 0;
      }
    }
  }

  digest(): string {
    if (this.currentBlockBytes > 0) {
      this.blockHashes.push(this.currentBlock.digest());
    }
    return createHash("sha256")
      .update(Buffer.concat(this.blockHashes))
      .digest("hex");
  }
}
