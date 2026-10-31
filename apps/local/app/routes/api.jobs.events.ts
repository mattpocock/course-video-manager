import type { Route } from "./+types/api.jobs.events";
import {
  requestSidecar,
  sidecarSocketPath,
} from "@/services/sidecar-socket.server";
import { JOB_STREAM_EVENTS } from "@/features/jobs/job-wire";
import { liveStreamEvent } from "@/features/streaming/live-stream-wire";
import {
  existingRecorderClient,
  liveStreamListeners,
} from "@/services/recorder-client/existing-client.server";

/**
 * The browser's one subscription to background **Jobs**: the **Sidecar**'s
 * Job Event stream (`GET /events` on its socket), passed through untouched.
 *
 * READ-ONLY: closing it — a closed tab, a reload — cancels nothing. The Jobs
 * run in the sidecar whether anyone listens or not. `Last-Event-ID` (which
 * the browser's EventSource sends on its own when it reconnects) is passed on,
 * so a tab that drops resumes where it left off.
 *
 * When nothing answers on the socket, it says so as an event and ends; the
 * EventSource tries again after `retry`. The status is always 200 and the
 * type always `text/event-stream`, because an EventSource that gets anything
 * else stops reconnecting for good.
 *
 * It is also the tab's one word on the LIVE STREAM (ADR 0055,
 * `live-stream-wire.ts`): the app server's own `live-stream-changed` events,
 * at once and on each change, between whole Job events (never inside one),
 * with no `id:` so the Last-Event-ID stays the last Job Event's.
 */
const RETRY_MS = 5_000;

/** The Live Stream as the app server's recorder client says it now. */
const liveStreamNow = () => existingRecorderClient()?.liveStream() ?? null;

const headers = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

export const loader = async ({ request }: Route.LoaderArgs) => {
  const socket = sidecarSocketPath();
  const lastEventId = request.headers.get("last-event-id");
  const upstreamAbort = new AbortController();
  request.signal.addEventListener("abort", () => upstreamAbort.abort());

  let upstream: Awaited<ReturnType<typeof requestSidecar>>;
  try {
    upstream = await requestSidecar({
      socket,
      method: "GET",
      path: "/events",
      headers: lastEventId ? { "last-event-id": lastEventId } : {},
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    const message = `The sidecar is not running (nothing answers on ${socket}): background jobs wait in the queue until it starts. ${String(error)}`;
    return new Response(
      `retry: ${RETRY_MS}\nevent: ${JOB_STREAM_EVENTS.sidecarUnavailable}\ndata: ${JSON.stringify({ message })}\n\n${liveStreamEvent(liveStreamNow())}`,
      { headers }
    );
  }

  const encoder = new TextEncoder();
  let stopListening = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      // No `id:`, so the browser's Last-Event-ID stays the last Job Event's.
      send(
        `retry: ${RETRY_MS}\nevent: ${JOB_STREAM_EVENTS.sidecarAvailable}\ndata: {}\n\n`
      );
      send(liveStreamEvent(liveStreamNow()));
      // The sidecar's bytes go on whole events at a time, so a Live Stream
      // event can go between two.
      const decoder = new TextDecoder();
      let partial = "";
      upstream.on("data", (chunk: Buffer) => {
        partial += decoder.decode(chunk, { stream: true });
        const end = partial.lastIndexOf("\n\n");
        if (end === -1) return;
        send(partial.slice(0, end + 2));
        partial = partial.slice(end + 2);
      });
      const listener = (heard: Parameters<typeof liveStreamEvent>[0]) =>
        send(liveStreamEvent(heard));
      liveStreamListeners().add(listener);
      stopListening = () => void liveStreamListeners().delete(listener);
      // The sidecar went away mid-stream (a restart): end, and let the
      // browser reconnect.
      const end = () => {
        stopListening();
        controller.close();
      };
      upstream.on("end", end);
      upstream.on("error", end);
    },
    cancel() {
      stopListening();
      upstreamAbort.abort();
      upstream.destroy();
    },
  });
  return new Response(stream, { headers });
};
