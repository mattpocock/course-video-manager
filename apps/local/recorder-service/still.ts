import type http from "node:http";
import { corsHeaders } from "./allowed-origin";
import {
  STILL_NO_PICTURE,
  STILL_RECORDER_CLOSED,
  STILL_WHILE_RECORDING,
  type RecorderState,
} from "./protocol";

/** A still older than this is not the camera now: the preview process stalled or quit. */
const STILL_MAX_AGE_MS = 2_000;

/** `GET /still`: the camera's latest still, or why there is none. */
export const serveStill = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: RecorderState,
  still: { jpeg: Buffer; atMs: number } | undefined
) => {
  const headers = {
    "Cache-Control": "no-store",
    ...corsHeaders(req.headers.origin),
  };
  const refusal =
    state.kind === "closed"
      ? STILL_RECORDER_CLOSED
      : state.kind === "recording"
        ? STILL_WHILE_RECORDING
        : state.camera.kind !== "live" ||
            !still ||
            Date.now() - still.atMs > STILL_MAX_AGE_MS
          ? STILL_NO_PICTURE
          : undefined;
  if (refusal || !still) {
    res.writeHead(state.kind === "open" ? 503 : 409, {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(refusal);
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": "image/jpeg" });
  res.end(still.jpeg);
};
