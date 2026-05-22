import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import {
  generateChaptersSystemPrompt,
  buildChaptersUserMessage,
} from "@/prompts/generate-chapters";
import { Console, Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.suggest-chapters";
import { anthropic } from "@ai-sdk/anthropic";
import { streamObject } from "ai";
import { data } from "react-router";
import { z } from "zod";

const proposalSchema = z.object({
  sections: z.array(
    z.object({
      beforeClipId: z.string(),
      title: z.string(),
    })
  ),
});

type ProposedSection = { beforeClipId: string; title: string };

const isCompleteSection = (s: unknown): s is ProposedSection =>
  !!s &&
  typeof (s as ProposedSection).beforeClipId === "string" &&
  typeof (s as ProposedSection).title === "string";

export const loader = async (args: Route.LoaderArgs) => {
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps.getVideoWithClipsById(videoId);

    const clips = video.clips.map((c) => ({
      id: c.id,
      order: c.order,
      text: c.text ?? "",
    }));
    const validIds = new Set(clips.map((c) => c.id));

    const existingSections = video.chapters.map((s) => ({
      order: s.order,
      name: s.name,
    }));

    const userMessage = buildChaptersUserMessage({
      clips,
      existingSections,
    });

    const abortController = new AbortController();

    const result = streamObject({
      model: anthropic("claude-sonnet-4-5"),
      schema: proposalSchema,
      system: generateChaptersSystemPrompt,
      messages: [{ role: "user", content: userMessage }],
      abortSignal: abortController.signal,
    });

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

        let emitted = 0;
        let lastPartialSections: unknown[] = [];

        try {
          for await (const partial of result.partialObjectStream) {
            const sections = (partial.sections ?? []) as unknown[];
            lastPartialSections = sections;
            // All sections except the last in the array are guaranteed complete.
            const completeCount = Math.max(0, sections.length - 1);
            while (emitted < completeCount) {
              const s = sections[emitted];
              if (isCompleteSection(s) && validIds.has(s.beforeClipId)) {
                send("section", s);
              }
              emitted++;
            }
          }
          // Stream done — flush any remaining items (including the final one).
          while (emitted < lastPartialSections.length) {
            const s = lastPartialSections[emitted];
            if (isCompleteSection(s) && validIds.has(s.beforeClipId)) {
              send("section", s);
            }
            emitted++;
          }
          send("done", {});
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          controller.close();
        }
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
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
