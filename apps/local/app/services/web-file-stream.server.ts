import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/**
 * The bytes of a file as a body a `Response` can actually hold.
 *
 * EVERY route in this app that streams a file off the disk — a frame, a WAV, a
 * thumbnail layer, a whole video — goes through here, and the reason is one
 * crash.
 *
 * A Node read stream is not a `ReadableStream`, so `new Response(stream)`
 * compiles only behind an `as any`. `undici` then sees an object it does not
 * recognise, notices it is async-iterable, and wraps it in its own
 * `ReadableStreamFrom`, which reacts to end-of-file like this:
 *
 * ```js
 * if (done) {
 *   queueMicrotask(() => {
 *     controller.close();
 *   });
 * }
 * ```
 *
 * If the browser abandons the request inside that one microtask, the cancel
 * closes the stream first and `controller.close()` throws
 * `TypeError: Invalid state: ReadableStream is already closed` — from a
 * microtask, with no caller to catch it, so it is an UNCAUGHT EXCEPTION that
 * takes the whole server down. The stack names only `undici` and
 * `task_queues`, never the route that served the file.
 *
 * A browser abandons media requests all the time. The Animatic is the worst
 * case: seeking the scrub bar cancels the in-flight WAV range request, and
 * every frame it premounts cancels a PNG. Watching one Animatic reliably killed
 * `pnpm dev`.
 *
 * `Readable.toWeb` is the supported conversion. It needs no cast, has no such
 * window, and destroys the file handle when the consumer cancels. Use it, and
 * never hand a Node stream to a `Response` again.
 */
export function webFileStream(
  absolutePath: string,
  /**
   * An inclusive byte window, for a `206`. Both ends are required — a
   * half-given window is the bug this signature refuses to allow.
   */
  window?: { start: number; end: number }
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(absolutePath, window)
  ) as ReadableStream<Uint8Array>;
}
