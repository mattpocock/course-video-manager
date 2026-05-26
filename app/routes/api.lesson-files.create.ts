import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import path from "path";

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const p = payload as Record<string, unknown>;
      const videoId = p.videoId;
      const filenameParam = p.filename;
      const textContent = p.content;

      if (typeof videoId !== "string" || !videoId) {
        return yield* Effect.die(data("videoId is required", { status: 400 }));
      }

      if (typeof filenameParam !== "string" || !filenameParam) {
        return yield* Effect.die(data("filename is required", { status: 400 }));
      }

      if (typeof textContent !== "string") {
        return yield* Effect.die(
          data("content must be provided", { status: 400 })
        );
      }

      const videoOps = yield* VideoOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoWithClipsById(videoId);
      if (video.lessonId === null) {
        return yield* Effect.die(
          data("Cannot add files to standalone videos via this endpoint", {
            status: 400,
          })
        );
      }

      const lesson = video.lesson!;
      const repo = lesson.section.repoVersion.repo;
      const section = lesson.section;
      const lessonPath = path.join(repo.filePath!, section.path, lesson.path);

      let filename: string;
      let fileData: Uint8Array;

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

        filename = filenameParam;

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileData = bytes;
      } else {
        filename = filenameParam;
        fileData = new TextEncoder().encode(textContent);
      }

      const filePath = path.join(lessonPath, filename);

      const fileExists = yield* fs.exists(filePath);
      if (fileExists) {
        return yield* Effect.die(data("File already exists", { status: 409 }));
      }

      yield* fs.writeFile(filePath, fileData);

      return { success: true, filename };
    }),
});
