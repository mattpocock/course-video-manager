import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = join(import.meta.dirname, "..", "assets", "effects");
const WHITE_NOISE_PATH = join(ASSETS_DIR, "white-noise.mp4");

if (existsSync(WHITE_NOISE_PATH)) {
  console.log("✓ assets/effects/white-noise.mp4 already exists, skipping");
  process.exit(0);
}

console.log("Generating assets/effects/white-noise.mp4...");

mkdirSync(ASSETS_DIR, { recursive: true });

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=854x480:d=1.0,geq=random(1)*255:128:128,format=gray",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:d=1.0",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-af",
    "volume=-18dB",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-shortest",
    WHITE_NOISE_PATH,
  ],
  { stdio: "inherit" }
);

console.log("✓ Generated assets/effects/white-noise.mp4");
