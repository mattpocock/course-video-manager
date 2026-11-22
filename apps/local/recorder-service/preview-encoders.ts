import type { PreviewEncoder } from "./capture-args";

/**
 * WHAT ENCODES EACH PREVIEW PROCESS (#2194). Both start on NVENC. A take
 * holds four NVENC sessions (camera.mkv, screen.mkv and the two previews,
 * which run whether a take does or not, #2207); the RTX 4060 opened nine at
 * once. Should a preview process fail to open NVENC all the same (every
 * session taken, no usable GPU), that feed moves to libx264 on the CPU for
 * the rest of the service's life, and the log says so. A preview process
 * holds no device and writes no Footage, so its failing never touches a
 * take.
 */

export type PreviewFeed = "camera" | "screen";

/**
 * What ffmpeg prints when h264_nvenc will not open: no session free
 * (`OpenEncodeSessionEx failed: out of memory (10)`), no capable device, or
 * any error h264_nvenc itself logs.
 */
const NVENC_FAILED =
  /OpenEncodeSessionEx failed|No (NVENC )?capable devices found|\[h264_nvenc @ [^\]]*\] \[(error|fatal)\]/i;

/** Whether a preview's stderr says NVENC would not open. */
export const saysNvencFailed = (stderr: string) => NVENC_FAILED.test(stderr);

export type PreviewEncoders = {
  get: (feed: PreviewFeed) => PreviewEncoder;
  /**
   * A preview process of `feed` quit with this stderr. Moves the feed to
   * libx264 if it says NVENC failed; true when it did, so the caller starts
   * it again at once.
   */
  quit: (feed: PreviewFeed, stderr: string) => boolean;
};

export const createPreviewEncoders = (): PreviewEncoders => {
  const encoders: Record<PreviewFeed, PreviewEncoder> = {
    camera: "nvenc",
    screen: "nvenc",
  };
  return {
    get: (feed) => encoders[feed],
    quit: (feed, stderr) => {
      if (encoders[feed] !== "nvenc" || !saysNvencFailed(stderr)) return false;
      encoders[feed] = "x264";
      const line = stderr.split(/\r?\n/).find((l) => NVENC_FAILED.test(l));
      console.error(
        `recorder: the ${feed} preview could not open NVENC (${line?.trim()}); encoding it with libx264 on the CPU until the service restarts`
      );
      return true;
    },
  };
};
