import { Effect } from "effect";
import { BackgroundRemovalService } from "@/services/background-removal-service";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[2]) {
    throw new Error("Invalid base64 data URL format");
  }
  const binaryString = atob(match[2]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64DataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export const action = makeAction({
  input: "json",
  dump: false,
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { imageDataUrl } = payload as any;

      if (
        typeof imageDataUrl !== "string" ||
        !imageDataUrl.startsWith("data:")
      ) {
        return yield* Effect.die(
          data("imageDataUrl is required and must be a base64 data URL", {
            status: 400,
          })
        );
      }

      const imageBytes = decodeDataUrl(imageDataUrl);
      const bgRemoval = yield* BackgroundRemovalService;
      const resultBytes = yield* bgRemoval.removeBackground(imageBytes);
      const resultDataUrl = uint8ArrayToBase64DataUrl(resultBytes);

      return { success: true, imageDataUrl: resultDataUrl };
    }),
});
