import { after } from "@/packages/clock";

/**
 * A recorder preview feed in the browser (#2192): one long `GET
 * /preview/<feed>` of H.264 the service relays from ffmpeg.exe
 * (`preview-feeds.ts`), decoded here with WebCodecs (hardware decode where
 * the browser has it, tuned for latency) and handed on frame by frame, full
 * size. Each chunk is one byte saying what follows (0: the avcC config, 1: a
 * keyframe, 2: any other frame), its length (4 bytes, big-endian), then it.
 *
 * Never a backlog: a frame the decoder cannot take at once (more than
 * `MAX_DECODE_QUEUE` waiting) means the decoder skips ahead to the next
 * keyframe; the service does the same for a browser that reads too slowly.
 * A decoder error or a dropped stream starts again from the next keyframe.
 *
 * No imports: the preview latency script (`scripts/preview-latency.ts`)
 * serves this file to its browser as it is.
 */

/** Waited before asking again after a failed request (service gone, restarting). */
const RETRY_MS = 500;

/** Frames that may wait for the decoder before it skips to the next keyframe. */
const MAX_DECODE_QUEUE = 2;

const CHUNK_HEAD = 5;

/** The codec string of an avcC record: `avc1.` and its profile, constraints and level. */
export const avcCodec = (avcC: Uint8Array) =>
  `avc1.${[avcC[1], avcC[2], avcC[3]]
    .map((b) => (b ?? 0).toString(16).padStart(2, "0"))
    .join("")}`;

/** Splits the response's bytes into its chunks, across reads. */
const chunkReader = (onChunk: (kind: number, data: Uint8Array) => void) => {
  let buffer = new Uint8Array(0);
  return (bytes: Uint8Array) => {
    const joined = new Uint8Array(buffer.length + bytes.length);
    joined.set(buffer);
    joined.set(bytes, buffer.length);
    let at = 0;
    while (joined.length - at >= CHUNK_HEAD) {
      const view = new DataView(joined.buffer, joined.byteOffset + at);
      const length = view.getUint32(1);
      if (joined.length - at < CHUNK_HEAD + length) break;
      onChunk(
        view.getUint8(0),
        joined.subarray(at + CHUNK_HEAD, at + CHUNK_HEAD + length)
      );
      at += CHUNK_HEAD + length;
    }
    buffer = joined.slice(at);
  };
};

/**
 * Calls `onFrame` with each new frame of the feed at `url` until the
 * returned stop is called. The frame is the caller's: it should `close()` it
 * once it draws a newer one.
 */
export const watchLatestFrame = (
  url: string,
  onFrame: (frame: VideoFrame) => void
): (() => void) => {
  const controller = new AbortController();
  const { signal } = controller;
  const pause = () =>
    new Promise<void>((resolve) => {
      const cancelTimer = after(RETRY_MS, resolve);
      signal.addEventListener("abort", () => {
        cancelTimer();
        resolve();
      });
    });

  let decoder: VideoDecoder | undefined;
  let config: VideoDecoderConfig | undefined;
  /** Waiting for a keyframe: at the start, after an error, after skipping. */
  let needKey = true;
  let timestamp = 0;

  const newDecoder = () => {
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = undefined;
    if (!config) return;
    const d = new VideoDecoder({
      output: (frame) => {
        if (signal.aborted) frame.close();
        else onFrame(frame);
      },
      error: () => {
        // Start again, from the next keyframe.
        if (decoder === d) decoder = undefined;
        needKey = true;
      },
    });
    d.configure(config);
    decoder = d;
  };

  const onChunk = (kind: number, data: Uint8Array) => {
    if (kind === 0) {
      config = {
        codec: avcCodec(data),
        description: data.slice(),
        optimizeForLatency: true,
      };
      newDecoder();
      needKey = true;
      return;
    }
    const key = kind === 1;
    if (!key && (needKey || !decoder)) return;
    if (!decoder) newDecoder();
    const d = decoder;
    if (!d || d.state !== "configured") return;
    if (d.decodeQueueSize > MAX_DECODE_QUEUE && !key) {
      needKey = true;
      return;
    }
    needKey = false;
    timestamp += 1;
    d.decode(
      new EncodedVideoChunk({
        type: key ? "key" : "delta",
        timestamp,
        data,
      })
    );
  };

  const run = async () => {
    while (!signal.aborted) {
      try {
        const res = await fetch(url, { signal, cache: "no-store" });
        if (!res.ok || !res.body) {
          await pause();
          continue;
        }
        const read = chunkReader(onChunk);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          read(value);
        }
        // The service closed it (restarting): ask again shortly.
        needKey = true;
        await pause();
      } catch {
        needKey = true;
        if (!signal.aborted) await pause();
      }
    }
  };
  void run();
  return () => {
    controller.abort();
    if (decoder && decoder.state !== "closed") decoder.close();
  };
};
