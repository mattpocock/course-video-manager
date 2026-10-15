import { open, type FileHandle } from "node:fs/promises";

/**
 * ONE CLIP'S SPAN OF A MATROSKA FILE, READ CHEAPLY (#2224).
 *
 * A take's `mic.mkv` has no Cues while it is still being written, so
 * `ffmpeg -ss` on it reads every byte from the start up to the Clip: 33 MB
 * for a Clip at minute 28, from the very disk the camera writer is writing
 * to, for every Clip of the take. This finds the Clip's Clusters with a few
 * small reads instead (a binary search on the Clusters' own timestamps) and
 * copies out the file's header plus only those Clusters. ffmpeg reads that
 * copy as a normal Matroska file whose timestamps are still the mic file's.
 *
 * The header's SeekHead and Cues (they point at offsets in the whole file)
 * become Void elements of the same size, and the Segment's size becomes
 * "unknown", so ffmpeg reads the copy to its end and never seeks elsewhere.
 */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Cues: 0x1c53bb6b,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  Crc32: 0xbf,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecDelay: 0x56aa,
  Void: 0xec,
} as const;

const CLUSTER_ID_BYTES = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

/** How much one probe reads: several Clusters of 192 kbps AAC. */
const PROBE_BYTES = 64 * 1024;
/** The most header read before giving up on the file. */
const MAX_HEADER_BYTES = 1024 * 1024;
/** Read this much audio before the Clip, so the decoder settles. */
const LEAD_IN_SECONDS = 1;

export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

interface Vint {
  readonly length: number;
  readonly value: number;
  readonly unknown: boolean;
}

/** An EBML variable-length size; `null` when it runs off the buffer. */
const readSize = (buf: Buffer, pos: number): Vint | null => {
  if (pos >= buf.length) return null;
  const first = buf[pos]!;
  if (first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { length, value, unknown: allOnes };
};

/** An EBML element ID, marker bits kept. */
const readId = (
  buf: Buffer,
  pos: number
): { length: number; id: number } | null => {
  if (pos >= buf.length) return null;
  const first = buf[pos]!;
  if (first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i]!;
  return { length, id };
};

const readUint = (buf: Buffer, pos: number, length: number) => {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]!;
  return value;
};

/** An EBML size of `length` bytes that means "unknown". */
const unknownSize = (length: number) => {
  const bytes = Buffer.alloc(length, 0xff);
  bytes[0] = (0x100 >> (length - 1)) - 1;
  return bytes;
};

/** Overwrites `total` (at least 9) bytes at `pos` with one Void element. */
const voidOut = (buf: Buffer, pos: number, total: number) => {
  const payload = total - 9;
  buf[pos] = ID.Void;
  buf[pos + 1] = 0x01; // an 8-byte size: 0x01 then 7 bytes of value
  buf.writeUIntBE(Math.floor(payload / 2 ** 32), pos + 2, 3);
  buf.writeUInt32BE(payload % 2 ** 32, pos + 5);
  buf.fill(0, pos + 9, pos + total);
};

interface Header {
  /** EBML header + Segment head + every element before the first Cluster. */
  readonly bytes: Buffer;
  /** Nanoseconds per Cluster timestamp tick. */
  readonly timestampScale: number;
  /**
   * ffmpeg's `start_time` for the file, in seconds, which `-ss` counts from:
   * its first Block's time less its track's CodecDelay (-0.021 for the
   * recorder's AAC, the encoder's priming).
   */
  readonly startSeconds: number;
}

/** The time of the first Block in the Cluster at `pos`, in ticks. */
const firstBlockTicks = (buf: Buffer, pos: number): number => {
  const cluster = readId(buf, pos);
  const clusterSize = cluster && readSize(buf, pos + cluster.length);
  if (!cluster || !clusterSize) return 0;
  let clusterTicks = 0;
  for (let p = pos + cluster.length + clusterSize.length; p < buf.length;) {
    const id = readId(buf, p);
    const size = id && readSize(buf, p + id.length);
    if (!id || !size || size.unknown) return clusterTicks;
    const data = p + id.length + size.length;
    if (id.id === ID.Timestamp) clusterTicks = readUint(buf, data, size.value);
    let block = id.id === ID.SimpleBlock ? data : -1;
    if (id.id === ID.BlockGroup) {
      const inner = readId(buf, data);
      const innerSize = inner && readSize(buf, data + inner.length);
      if (inner?.id === ID.Block && innerSize)
        block = data + inner.length + innerSize.length;
    }
    if (block !== -1) {
      const track = readSize(buf, block);
      if (!track || block + track.length + 2 > buf.length) return clusterTicks;
      return clusterTicks + buf.readInt16BE(block + track.length);
    }
    p = data + size.value;
  }
  return clusterTicks;
};

/** The header from the first `PROBE_BYTES`, or (rarely) a longer read. */
const readHeader = async (src: ByteSource): Promise<Header | null> =>
  (await parseHeader(await src.read(0, Math.min(src.size, PROBE_BYTES)))) ??
  (src.size > PROBE_BYTES
    ? parseHeader(await src.read(0, Math.min(src.size, MAX_HEADER_BYTES)))
    : null);

const parseHeader = async (buf: Buffer): Promise<Header | null> => {
  const ebml = readId(buf, 0);
  if (!ebml || ebml.id !== ID.EBML) return null;
  const ebmlSize = readSize(buf, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  const segmentPos = ebml.length + ebmlSize.length + ebmlSize.value;
  const segment = readId(buf, segmentPos);
  if (!segment || segment.id !== ID.Segment) return null;
  const segmentSizePos = segmentPos + segment.length;
  const segmentSize = readSize(buf, segmentSizePos);
  if (!segmentSize) return null;

  const bytes = Buffer.from(buf);
  unknownSize(segmentSize.length).copy(bytes, segmentSizePos);
  let timestampScale = 1_000_000;
  let codecDelayNs = 0;
  let pos = segmentSizePos + segmentSize.length;
  for (;;) {
    const child = readId(bytes, pos);
    if (!child) return null;
    if (child.id === ID.Cluster)
      return {
        bytes: bytes.subarray(0, pos),
        timestampScale,
        // ffmpeg counts the delay in whole ticks, as it does every time.
        startSeconds:
          ((firstBlockTicks(buf, pos) -
            Math.round(codecDelayNs / timestampScale)) *
            timestampScale) /
          1e9,
      };
    const size = readSize(bytes, pos + child.length);
    if (!size || size.unknown) return null;
    const dataPos = pos + child.length + size.length;
    const end = dataPos + size.value;
    if (end > bytes.length) return null;
    if (child.id === ID.Info) {
      for (let p = dataPos; p < end;) {
        const id = readId(bytes, p);
        const s = id && readSize(bytes, p + id.length);
        if (!id || !s) break;
        if (id.id === ID.TimestampScale)
          timestampScale = readUint(bytes, p + id.length + s.length, s.value);
        p += id.length + s.length + s.value;
      }
    }
    if (child.id === ID.Tracks) {
      // Its TrackEntry (after ffmpeg's CRC-32): the mic file has one track.
      for (let t = dataPos; t < end;) {
        const entry = readId(bytes, t);
        const entrySize = entry && readSize(bytes, t + entry.length);
        if (!entry || !entrySize) break;
        const entryData = t + entry.length + entrySize.length;
        if (entry.id === ID.TrackEntry) {
          for (let p = entryData; p < entryData + entrySize.value;) {
            const id = readId(bytes, p);
            const sz = id && readSize(bytes, p + id.length);
            if (!id || !sz) break;
            if (id.id === ID.CodecDelay)
              codecDelayNs = readUint(
                bytes,
                p + id.length + sz.length,
                sz.value
              );
            p += id.length + sz.length + sz.value;
          }
          break;
        }
        t = entryData + entrySize.value;
      }
    }
    if (child.id === ID.SeekHead || child.id === ID.Cues) {
      if (end - pos < 9) return null;
      voidOut(bytes, pos, end - pos);
    }
    pos = end;
  }
};

interface Cluster {
  readonly pos: number;
  readonly seconds: number;
}

/** The first Cluster that starts at or after `from`, if one is in reach. */
const probeCluster = async (
  src: ByteSource,
  from: number,
  timestampScale: number
): Promise<Cluster | null> => {
  const buf = await src.read(from, Math.min(PROBE_BYTES, src.size - from));
  for (
    let i = buf.indexOf(CLUSTER_ID_BYTES);
    i !== -1;
    i = buf.indexOf(CLUSTER_ID_BYTES, i + 1)
  ) {
    // Audio can hold these four bytes by chance: a real Cluster opens with
    // its Timestamp (after ffmpeg's CRC-32, when it writes one).
    const size = readSize(buf, i + 4);
    if (!size) continue;
    let tsPos = i + 4 + size.length;
    if (buf[tsPos] === ID.Crc32 && buf[tsPos + 1] === 0x84) tsPos += 6;
    if (buf[tsPos] !== ID.Timestamp) continue;
    const tsSize = readSize(buf, tsPos + 1);
    if (!tsSize || tsSize.value > 8) continue;
    const valuePos = tsPos + 1 + tsSize.length;
    if (valuePos + tsSize.value > buf.length) continue;
    return {
      pos: from + i,
      seconds: (readUint(buf, valuePos, tsSize.value) * timestampScale) / 1e9,
    };
  }
  return null;
};

/**
 * Binary search on byte offsets in `[lo, hi)` for the boundary where
 * `before(cluster)` stops holding: the last Cluster found for which it holds,
 * and the first for which it does not.
 */
const searchClusters = async (
  src: ByteSource,
  timestampScale: number,
  lo: number,
  hi: number,
  before: (c: Cluster) => boolean
) => {
  let last: Cluster | null = null;
  let firstAfter: Cluster | null = null;
  while (hi - lo > PROBE_BYTES / 2) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await probeCluster(src, mid, timestampScale);
    if (c && before(c)) {
      last = c;
      lo = mid;
    } else {
      if (c && (!firstAfter || c.pos < firstAfter.pos)) firstAfter = c;
      hi = mid;
    }
  }
  return { last, firstAfter };
};

/**
 * Where a Clip's span is in a Matroska file: its header (patched as above)
 * and the byte range of the Clusters that hold `[startSeconds, endSeconds]`,
 * with a second's lead-in. `null` when the file is not Matroska ffmpeg can be
 * given this way; read it whole then.
 */
export const findMkvSpan = async (
  src: ByteSource,
  startSeconds: number,
  endSeconds: number
): Promise<{
  header: Buffer;
  from: number;
  to: number;
  startSeconds: number;
} | null> => {
  const header = await readHeader(src);
  if (!header) return null;
  const first = header.bytes.length;
  const from = await searchClusters(
    src,
    header.timestampScale,
    first,
    src.size,
    (c) => c.seconds <= startSeconds - LEAD_IN_SECONDS
  );
  const fromPos = from.last?.pos ?? first;
  const to = await searchClusters(
    src,
    header.timestampScale,
    fromPos,
    src.size,
    (c) => c.seconds <= endSeconds + LEAD_IN_SECONDS
  );
  return {
    header: header.bytes,
    startSeconds: header.startSeconds,
    from: fromPos,
    to: to.firstAfter?.pos ?? src.size,
  };
};

const fileSource = async (handle: FileHandle): Promise<ByteSource> => {
  const { size } = await handle.stat();
  return {
    size,
    read: async (offset, length) => {
      const buf = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    },
  };
};

/**
 * Writes `outputPath`: a Matroska file holding only the Clusters of
 * `inputPath` around `[startSeconds, endSeconds]`, timestamps unchanged.
 * Returns the file's `start_time` (see {@link Header}), or `null`, writing
 * nothing, when `inputPath` cannot be cut this way.
 */
export const copyMkvSpan = async (
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number
): Promise<{ startSeconds: number } | null> => {
  const input = await open(inputPath, "r");
  try {
    const src = await fileSource(input);
    const span = await findMkvSpan(src, startSeconds, endSeconds);
    if (!span) return null;
    const output = await open(outputPath, "w");
    try {
      await output.write(span.header);
      const CHUNK = 1024 * 1024;
      for (let pos = span.from; pos < span.to; pos += CHUNK) {
        const bytes = await src.read(pos, Math.min(CHUNK, span.to - pos));
        if (bytes.length === 0) break;
        await output.write(bytes);
      }
    } finally {
      await output.close();
    }
    return { startSeconds: span.startSeconds };
  } finally {
    await input.close();
  }
};
