import { join } from "node:path";
import {
  ensureWhiteNoiseAsset,
  WHITE_NOISE_LOUDNESS_LUFS,
} from "./white-noise-asset";
import { log } from "@/packages/log";

const WHITE_NOISE_PATH = join(
  import.meta.dirname,
  "..",
  "assets",
  "effects",
  "white-noise.mp4"
);

const outcome = ensureWhiteNoiseAsset(WHITE_NOISE_PATH);
log.info(
  outcome === "kept"
    ? `✓ assets/effects/white-noise.mp4 is already at ${WHITE_NOISE_LOUDNESS_LUFS} LUFS, skipping`
    : `✓ Generated assets/effects/white-noise.mp4 at ${WHITE_NOISE_LOUDNESS_LUFS} LUFS`
);
