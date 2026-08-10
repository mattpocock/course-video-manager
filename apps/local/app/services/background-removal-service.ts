/**
 * Background Removal Service - Prototype (Issue #218)
 *
 * Uses the remove.bg API to remove backgrounds from images.
 *
 * Research: Three options were evaluated:
 *
 * 1. remove.bg API (CHOSEN)
 *    - Cloud API with excellent quality
 *    - $1.99/image at scale, 50 free/month for prototyping
 *    - Requires API key (REMOVE_BG_API_KEY env var)
 *    - Speed: 1-3s per image
 *    - Best quality on indoor/office backgrounds
 *
 * 2. @huggingface/transformers (RMBG model)
 *    - Free, runs locally in Node.js using ONNX
 *    - ~300k weekly npm downloads, well-maintained
 *    - Good quality, but heavier dependency (~40MB model download)
 *    - Speed: 3-10s per image
 *
 * 3. @imgly/background-removal-node
 *    - Free, local ONNX-based removal
 *    - Low npm adoption
 *    - Similar quality/speed to transformers.js approach
 *
 * Decision: remove.bg chosen for prototype because it has the best
 * quality and simplest integration (single HTTP call, no model downloads).
 * Free tier is sufficient for validating the thumbnail workflow.
 */

import { Data, Effect } from "effect";

export class BackgroundRemovalError extends Data.TaggedError(
  "BackgroundRemovalError"
)<{
  cause: unknown;
  message: string;
}> {}

export class BackgroundRemovalService extends Effect.Service<BackgroundRemovalService>()(
  "BackgroundRemovalService",
  {
    effect: Effect.gen(function* () {
      const removeBackground = Effect.fn("removeBackground")(function* (
        imageBuffer: Uint8Array
      ) {
        const apiKey = process.env.REMOVE_BG_API_KEY;
        if (!apiKey) {
          return yield* new BackgroundRemovalError({
            cause: null,
            message: "REMOVE_BG_API_KEY is not set in environment variables",
          });
        }

        const formData = new FormData();
        formData.append(
          "image_file",
          new Blob([imageBuffer.buffer as ArrayBuffer]),
          "image.png"
        );
        formData.append("size", "auto");

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch("https://api.remove.bg/v1.0/removebg", {
              method: "POST",
              headers: {
                "X-Api-Key": apiKey,
              },
              body: formData,
            }),
          catch: (e) =>
            new BackgroundRemovalError({
              cause: e,
              message: `Failed to call remove.bg API: ${e}`,
            }),
        });

        if (!response.ok) {
          const errorText = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () => "unknown error",
          });
          return yield* new BackgroundRemovalError({
            cause: errorText,
            message: `remove.bg API returned ${response.status}: ${errorText}`,
          });
        }

        const arrayBuffer = yield* Effect.tryPromise({
          try: () => response.arrayBuffer(),
          catch: (e) =>
            new BackgroundRemovalError({
              cause: e,
              message: `Failed to read response body: ${e}`,
            }),
        });

        return new Uint8Array(arrayBuffer);
      });

      return { removeBackground };
    }),
  }
) {}
