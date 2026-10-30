import { broadcastChat } from "@/services/broadcast-chat-live.server";

/**
 * The Streaming tab's subscription to the picked Broadcast's live chat
 * (`BroadcastChatEvent`, one SSE event each, named by its `type`): what the
 * app server holds first, then each message as it's posted. It only
 * listens: closing it stops nothing, because the app server reads the chat
 * from the pick until End Stream whether anyone listens.
 */
export const loader = ({ request }: { request: Request }) => {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = broadcastChat().subscribe((event) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          )
        );
      });
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by `cancel`.
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
