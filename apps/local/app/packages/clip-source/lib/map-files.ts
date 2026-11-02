import { Effect } from "effect";
import type { ClipFrame, ClipSource } from "./clip-source";

/**
 * The same Clip Source with every file it reads passed through `f`: its
 * Footage file, or its Recording Session's camera, screen and mic. For
 * turning stored (root-relative) paths into the files on disk before ffmpeg
 * opens them. Never hash the result: the Export Hash is taken from the
 * stored paths ({@link clipSourceHashFields}).
 */
export const mapClipSourceFiles = <E, R>(
  source: ClipSource,
  f: (file: string) => Effect.Effect<string, E, R>
): Effect.Effect<ClipSource, E, R> => {
  if (source.kind === "footage") {
    return Effect.map(f(source.footagePath), (footagePath) => ({
      ...source,
      footagePath,
    }));
  }
  return Effect.map(
    Effect.all({
      camera: f(source.files.camera),
      screen:
        source.files.screen === null
          ? Effect.succeed(null)
          : f(source.files.screen),
      mic: f(source.files.mic),
    }),
    (files) => ({ ...source, files })
  );
};

/**
 * The same still with every file it reads passed through `f` (its Footage
 * file, its screen, or its screen and camera), as {@link mapClipSourceFiles}
 * does for a Clip Source.
 */
export const mapClipFrameFiles = <E, R>(
  frame: ClipFrame,
  f: (file: string) => Effect.Effect<string, E, R>
): Effect.Effect<ClipFrame, E, R> => {
  if (frame.kind === "footage") {
    return Effect.map(f(frame.inputVideo), (inputVideo) => ({
      ...frame,
      inputVideo,
    }));
  }
  if (frame.kind === "screen") {
    return Effect.map(f(frame.screen), (screen) => ({ ...frame, screen }));
  }
  return Effect.map(
    Effect.all({
      camera: f(frame.camera),
      screen: frame.screen === null ? Effect.succeed(null) : f(frame.screen),
    }),
    ({ camera, screen }) => ({ ...frame, camera, screen })
  );
};
