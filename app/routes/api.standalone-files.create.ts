import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const formData = await args.request.formData();

  return makeAction({
    errors: { NotFoundError: 404 },
    effect: () =>
      Effect.gen(function* () {
        const videoId = formData.get("videoId");
        const filenameOverride = formData.get("filename");
        const file = formData.get("file");
        const textContent = formData.get("content");

        if (typeof videoId !== "string" || !videoId) {
          return yield* Effect.die(
            data("videoId is required", { status: 400 })
          );
        }

        const videoOps = yield* VideoOperationsService;
        const fs = yield* FileSystem.FileSystem;

        const video = yield* videoOps.getVideoDeepById(videoId);
        if (video.lessonId !== null) {
          return yield* Effect.die(
            data("Cannot add files to lesson-connected videos", { status: 400 })
          );
        }

        let filename: string;
        let fileData: Uint8Array;

        if (file instanceof File) {
          filename =
            typeof filenameOverride === "string" && filenameOverride.trim()
              ? filenameOverride.trim()
              : file.name;

          const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
          fileData = new Uint8Array(arrayBuffer);
        } else if (typeof textContent === "string") {
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

            if (typeof filenameOverride !== "string" || !filenameOverride) {
              return yield* Effect.die(
                data("filename is required for base64 content", { status: 400 })
              );
            }

            filename = filenameOverride;

            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            fileData = bytes;
          } else {
            if (typeof filenameOverride !== "string" || !filenameOverride) {
              return yield* Effect.die(
                data("filename is required for text content", { status: 400 })
              );
            }
            filename = filenameOverride;
            fileData = new TextEncoder().encode(textContent);
          }
        } else {
          return yield* Effect.die(
            data("Either file or content must be provided", { status: 400 })
          );
        }

        const videoDir = getStandaloneVideoFilePath(videoId);
        const filePath = getStandaloneVideoFilePath(videoId, filename);

        const fileExists = yield* fs.exists(filePath);
        if (fileExists) {
          return yield* Effect.die(
            data("File already exists", { status: 409 })
          );
        }

        const dirExists = yield* fs.exists(videoDir);
        if (!dirExists) {
          yield* fs.makeDirectory(videoDir, { recursive: true });
        }

        yield* fs.writeFile(filePath, fileData);

        return { success: true, filename };
      }),
  })(args);
};
