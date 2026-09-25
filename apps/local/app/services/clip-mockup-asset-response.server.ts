import { statSync } from "node:fs";
import path from "node:path";
import { webFileStream } from "./web-file-stream.server";

/**
 * Serving a Clip Mockup's frame and its speech to the browser.
 *
 * The frame and the WAV live under `{CLIP_MOCKUP_DIR}/{lineageId}/`, which is
 * outside anything Vite serves, so the only way a `<img>` or a Remotion
 * `<Audio>` can reach them is a resource route that streams the bytes back.
 *
 * RANGE SUPPORT IS THE POINT, not a nicety. Remotion's `<Audio>` seeks the
 * moment the Animatic's scrub bar moves, and a response with no
 * `Accept-Ranges` makes the browser treat the WAV as unseekable — the audio
 * would restart from zero on every jump. `view-video.ts` is the nearest prior
 * art in this app; this module is that shape, hardened (suffix ranges, an
 * unsatisfiable range answered with 416 rather than a broken 206) and lifted
 * out of the route so the header arithmetic can be tested without a server.
 *
 * Containment is NOT this module's job — it takes an already-resolved absolute
 * path. `resolveClipMockupPath` in `clip-mockup-files.ts` is what refuses a
 * path that escapes the Video's own directory, and every caller here goes
 * through it first.
 */

/**
 * Content types for what a Clip Mockup directory can hold. `audio/*` entries
 * exist nowhere else in this app — `api.video-files.read.ts`'s map has none,
 * which is why a WAV fetched through it arrives as an unseekable
 * `application/octet-stream`.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

/** The Content-Type a stored frame or speech file is served under. */
export function clipMockupAssetContentType(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

/**
 * The byte window a `Range` header asks for, clamped to the file.
 * `null` means "no usable range, send the whole thing"; `"unsatisfiable"`
 * means the client named a window that starts past the end of the file, which
 * HTTP answers with 416 rather than with the whole file.
 */
function parseRange(
  header: string | null,
  fileSize: number
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  // `bytes=-500` — the last 500 bytes.
  if (rawStart === "") {
    if (rawEnd === "") return null;
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }

  const start = Number(rawStart);
  if (start >= fileSize) return "unsatisfiable";

  // `bytes=500-` — from there to the end.
  const end =
    rawEnd === "" ? fileSize - 1 : Math.min(Number(rawEnd), fileSize - 1);
  if (end < start) return "unsatisfiable";

  return { start, end };
}

/**
 * Stream a file back, honouring an HTTP `Range` request. A file that is not
 * there answers 404 — the Animatic route reports a missing frame as missing
 * rather than showing a blank, and this is the same answer one layer down.
 */
export function clipMockupAssetResponse(
  absolutePath: string,
  request: Request
): Response {
  let fileSize: number;
  try {
    fileSize = statSync(absolutePath).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = clipMockupAssetContentType(absolutePath);
  const range = parseRange(request.headers.get("range"), fileSize);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (range) {
    return new Response(
      webFileStream(absolutePath, { start: range.start, end: range.end }),
      {
        status: 206,
        headers: {
          "Content-Range": `bytes ${range.start}-${range.end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(range.end - range.start + 1),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      }
    );
  }

  return new Response(webFileStream(absolutePath), {
    status: 200,
    headers: {
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    },
  });
}
