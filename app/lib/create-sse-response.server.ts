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
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent: SendEvent = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

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
          config.runtime.runPromise
        )
        .finally(() => {
          controller.close();
        });
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
