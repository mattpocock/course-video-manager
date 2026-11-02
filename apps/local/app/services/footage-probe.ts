import { Command } from "@effect/platform";
import { Context, Data, Effect } from "effect";

/**
 * What `cvm footage import` reads off a file before anything is copied: its
 * first video stream's size and sample aspect ratio, and its length. The
 * author waits on it for a moment, so it runs in the CLI, not as a Job.
 */
export interface FootageProbeResult {
  /** `null`: the file has no video stream. */
  readonly video: {
    readonly width: number;
    readonly height: number;
    /** As ffprobe spells it ("1:1", "4:3"); `null` when it gives none. */
    readonly sampleAspectRatio: string | null;
  } | null;
  readonly durationSeconds: number;
}

/** ffprobe could not read the file as media. */
export class FootageUnreadableError extends Data.TaggedError(
  "FootageUnreadableError"
)<{ readonly message: string }> {}

/** The probe, as a seam: tests answer for ffprobe here. */
export class FootageProbe extends Context.Tag("FootageProbe")<
  FootageProbe,
  {
    readonly probe: (
      path: string
    ) => Effect.Effect<FootageProbeResult, FootageUnreadableError>;
  }
>() {}

interface FfprobeJson {
  readonly streams?: ReadonlyArray<{
    readonly width?: number;
    readonly height?: number;
    readonly sample_aspect_ratio?: string;
  }>;
  readonly format?: { readonly duration?: string };
}

/** The real probe: one `ffprobe` run on the file. */
export const probeWithFfprobe = (path: string) =>
  Command.string(
    Command.make(
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,sample_aspect_ratio:format=duration",
      "-of",
      "json",
      path
    )
  ).pipe(
    Effect.mapError(
      (error) => new FootageUnreadableError({ message: String(error) })
    ),
    Effect.flatMap((stdout) =>
      Effect.try({
        try: () => JSON.parse(stdout) as FfprobeJson,
        catch: () =>
          new FootageUnreadableError({ message: "ffprobe printed no JSON" }),
      })
    ),
    Effect.flatMap((json) => {
      const duration = Number(json.format?.duration);
      if (json.format === undefined) {
        return Effect.fail(
          new FootageUnreadableError({ message: "ffprobe can't read it" })
        );
      }
      const stream = json.streams?.[0];
      return Effect.succeed<FootageProbeResult>({
        video:
          stream?.width && stream.height
            ? {
                width: stream.width,
                height: stream.height,
                sampleAspectRatio: stream.sample_aspect_ratio ?? null,
              }
            : null,
        durationSeconds: Number.isFinite(duration) ? duration : 0,
      });
    })
  );
