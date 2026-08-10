import { Effect, type ManagedRuntime } from "effect";

export type SendEvent = (event: string, data: unknown) => void;

interface SSEErrorHandler {
  tag: string;
  handler: (error: any, sendEvent: SendEvent) => void;
}

interface SSEResponseConfig<R, RE> {
  runtime: ManagedRuntime.ManagedRuntime<R, RE>;
  program: (sendEvent: SendEvent) => Effect.Effect<void, any, R>;
  errorHandlers?: SSEErrorHandler[];
  fallbackMessage?: string;
}

export function createSSEResponse<R, RE>(
  config: SSEResponseConfig<R, RE>
): Response {
  const encoder = new TextEncoder();
  // Aborts the running program when the client disconnects, so we stop
  // doing work (and enqueueing events) for a stream nobody is reading.
  const abortController = new AbortController();

  const stream = new ReadableStream({
    start(controller) {
      // Once the stream is closed — either because the program finished or
      // because the client disconnected (`cancel`) — any further enqueue or
      // close would throw "Invalid state: Controller is already closed".
      let closed = false;

      const sendEvent: SendEvent = (event, data) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      abortController.signal.addEventListener("abort", () => {
        closed = true;
      });

      let effect: Effect.Effect<void, any, any> = config.program(sendEvent);

      if (config.errorHandlers) {
        for (const { tag, handler } of config.errorHandlers) {
          effect = effect.pipe(
            Effect.catchTag(tag, (e) =>
              Effect.sync(() => handler(e, sendEvent))
            )
          );
        }
      }

      effect
        .pipe(
          Effect.catchAll((e) =>
            Effect.sync(() => {
              sendEvent("error", {
                message:
                  "message" in e && typeof e.message === "string"
                    ? e.message
                    : (config.fallbackMessage ??
                      "An unexpected error occurred"),
              });
            })
          ),
          (self) =>
            config.runtime.runPromise(self, {
              signal: abortController.signal,
            })
        )
        // The program may reject when interrupted by the abort signal; that
        // is expected on client disconnect and must not go unhandled.
        .catch(() => {})
        .finally(() => {
          if (closed) return;
          closed = true;
          controller.close();
        });
    },
    cancel() {
      // Client disconnected: the controller is already closed by the stream
      // machinery, so interrupt the program and let `start`'s `finally` skip
      // its own `controller.close()`.
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
