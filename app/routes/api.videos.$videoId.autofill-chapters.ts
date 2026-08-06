import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { TextGenerationService } from "@/services/text-generation-service";
import { Cause, Effect, Exit } from "effect";

/**
 * The per-Video **Autofill chapters** action, streamed so the editor can show
 * each Chapter as it is written and the author can confirm before anything
 * lands. The model call itself lives in TextGeneration — the same operation
 * the batch Autofill calls, just without its `onChapter` callback.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const textGeneration = yield* TextGenerationService;
      const video = yield* videoOps.getVideoWithClipsById(params.videoId!);

      const clips = video.clips.map((c) => ({
        id: c.id,
        order: c.order,
        text: c.text ?? "",
      }));

      const abortController = new AbortController();
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, payload: unknown) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
              )
            );
          };

          send("clips", {
            clips: clips.map((c) => ({ id: c.id, text: c.text })),
          });

          const exit = await Effect.runPromiseExit(
            textGeneration.autofillChapters({
              clips,
              existingChapters: video.chapters.map((chapter) => ({
                order: chapter.order,
                name: chapter.name,
              })),
              // Each Chapter reaches the preview as it is written — the
              // streaming half of the same operation.
              onChapter: (chapter) => send("section", chapter),
              signal: abortController.signal,
            })
          );

          if (Exit.isSuccess(exit)) {
            send("done", {});
          } else {
            const failure = Cause.failureOption(exit.cause);
            send("error", {
              message:
                failure._tag === "Some"
                  ? failure.value.message
                  : "Unknown error",
            });
          }
          controller.close();
        },
        cancel() {
          abortController.abort();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }),
});
