import { Config, Effect, Option } from "effect";

/**
 * How many heavy ffmpeg encodes the whole process runs at once — every pass
 * through `runFfmpegWithProgress` that encodes video (a Video's concat or its
 * Clip segments, its Definition Card composite) and a Short's subtitle
 * burn-in. The audio normalize stream-copies the video, so it takes a CPU
 * permit instead and runs alongside them.
 *
 * Two, from the evidence. Publish Job 859b8689 ran six 100-input concats at
 * once (`MAX_CONCURRENT_EXPORTS` 6, under what was then 6 GPU permits) on a
 * machine with 47 GiB of RAM; with NVENC gone they ran on libx264, the box
 * ran out of memory, and ffmpeg, the database connection and the sidecar's
 * lease all went with it. One 101-input concat (a real 11-minute Video,
 * measured with `/usr/bin/time -v` on 2026-10-09) peaks at 9.9 GiB RSS on
 * h264_nvenc and 10.4 GiB on the libx264 fallback: every input keeps its own
 * demuxer, decoder and filter queue open for the whole pass. Six want 62 GiB;
 * two want 21 GiB, leaving the rest for Postgres, the dev server, OBS and the
 * desktop. Three (31 GiB) would leave too little once anything else is busy.
 */
export const DEFAULT_ENCODE_PERMITS = 2;
export const DEFAULT_CPU_PERMITS = 12;

const permits = (name: string, fallback: number) =>
  Config.integer(name).pipe(
    Config.withDefault(fallback),
    Config.validate({
      message: `${name} must be at least 1`,
      validation: (value) => value >= 1,
    })
  );

/**
 * ffmpeg's process-wide limits. One instance per process, shared by the
 * interactive commands (`FFmpegCommandsService`) and the Sidecar's encodes
 * (`FFmpegEncodeService`), so every Job in the Sidecar — a Publish, a Batch
 * export and a Short at the same time — draws from the same slots.
 *
 * - **Encode slots** (`FFMPEG_ENCODE_PERMITS`, default
 *   {@link DEFAULT_ENCODE_PERMITS}): the heavy encodes. Taken by
 *   `runFfmpegWithProgress` itself, so no caller can forget one, through
 *   {@link FfmpegPermitsService.withEncodeSlot}.
 * - **CPU permits** (`FFMPEG_CPU_PERMITS`, default 12): the quick,
 *   interactive calls a page waits on — silence detection and the like —
 *   and the audio normalize, which stream-copies the video and never
 *   touches NVENC, so it overlaps the encodes rather than queueing for a
 *   slot.
 *
 * A verify-cvm clone run sets both to 1, so an agent's stray encode of a real
 * course runs one ffmpeg at a time.
 */
export class FfmpegPermitsService extends Effect.Service<FfmpegPermitsService>()(
  "FfmpegPermitsService",
  {
    effect: Effect.gen(function* () {
      const encodePermits = yield* permits(
        "FFMPEG_ENCODE_PERMITS",
        DEFAULT_ENCODE_PERMITS
      );
      const cpuPermits = yield* permits(
        "FFMPEG_CPU_PERMITS",
        DEFAULT_CPU_PERMITS
      );
      const encodeSemaphore = yield* Effect.makeSemaphore(encodePermits);

      /**
       * Run one heavy encode in an encode slot. When every slot is busy it
       * says so in the Job's log, waits, and says again how long it waited —
       * so a Video that sits at 0% is visibly queued, not hung.
       */
      const withEncodeSlot =
        (label: string) =>
        <A, E, R>(encode: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
          Effect.gen(function* () {
            const now =
              yield* encodeSemaphore.withPermitsIfAvailable(1)(encode);
            if (Option.isSome(now)) return now.value;

            yield* Effect.logInfo(
              `ffmpeg: all ${encodePermits} encode slots are busy; waiting for one`,
              { errorPrefix: label }
            );
            const waitingSince = Date.now();
            return yield* encodeSemaphore.withPermits(1)(
              Effect.suspend(() =>
                Effect.logInfo("ffmpeg: got an encode slot", {
                  errorPrefix: label,
                  waitedMs: Date.now() - waitingSince,
                })
              ).pipe(Effect.andThen(encode))
            );
          });

      return {
        encodePermits,
        cpuPermits,
        withEncodeSlot,
        cpuSemaphore: yield* Effect.makeSemaphore(cpuPermits),
      };
    }).pipe(Effect.orDie),
  }
) {}
