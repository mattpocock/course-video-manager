import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { videoFileExists, writeVideoFile } from "@/services/video-files";
import { data } from "react-router";

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404, InvalidVideoFilePathError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const p = payload as Record<string, unknown>;
      const videoId = p.videoId;
      const pathParam = p.path;
      const file = p.file;
      const textContent = p.content;

      if (typeof videoId !== "string" || !videoId) {
        return yield* Effect.die(data("videoId is required", { status: 400 }));
      }

      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoDeepById(videoId);

      let relativePath: string;
      let fileData: Uint8Array;

      if (file instanceof File) {
        // An uploaded part carries its own name, which `path` may override.
        relativePath =
          typeof pathParam === "string" && pathParam.trim()
            ? pathParam.trim()
            : file.name;

        const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
        fileData = new Uint8Array(arrayBuffer);
      } else if (typeof textContent === "string") {
        if (typeof pathParam !== "string" || !pathParam) {
          return yield* Effect.die(data("path is required", { status: 400 }));
        }
        relativePath = pathParam;

        if (textContent.startsWith("data:")) {
          const match = textContent.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) {
            return yield* Effect.die(
              data("Invalid base64 data URL format", { status: 400 })
            );
          }

          const base64Data = match[2];
          if (!base64Data) {
            return yield* Effect.die(
              data("Missing base64 data", { status: 400 })
            );
          }

          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileData = bytes;
        } else {
          fileData = new TextEncoder().encode(textContent);
        }
      } else {
        return yield* Effect.die(
          data("Either file or content must be provided", { status: 400 })
        );
      }

      const alreadyExists = yield* videoFileExists(
        video.lineageId,
        relativePath
      );
      if (alreadyExists) {
        return yield* Effect.die(data("File already exists", { status: 409 }));
      }

      yield* writeVideoFile(video.lineageId, relativePath, fileData);

      return { success: true, path: relativePath };
    }),
});
