import { readFile } from "node:fs/promises";
import { parseOverlayProps } from "./props";
import { renderSubtitleOverlay } from "./render";

const USAGE = `Render the subtitle + CTA overlay to a transparent ProRes 4444 .mov.

Usage:
  render-subtitle-overlay --props-file <path.json> --out <path.mov>
  render-subtitle-overlay --out <path.mov>   # props read from stdin

Options:
  --props-file <path>  JSON file with the overlay props. If omitted, props are
                       read from stdin.
  --out <path>         Output .mov location (required).
  --quiet              Do not print progress.
  -h, --help           Show this help.

Props JSON shape (see src/props.ts):
  { width, height, fps, durationInFrames, subtitles: [{startFrame,endFrame,text}], cta: {variant,durationInFrames}|null }`;

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseArgs = (argv: string[]) => {
  const args: { propsFile?: string; out?: string; quiet: boolean; help: boolean } =
    { quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--props-file":
        args.propsFile = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

export const main = async (argv: string[]): Promise<void> => {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  if (!args.out) {
    throw new Error("--out <path.mov> is required. See --help.");
  }

  const rawJson = args.propsFile
    ? await readFile(args.propsFile, "utf8")
    : await readStdin();
  const props = parseOverlayProps(JSON.parse(rawJson));

  const result = await renderSubtitleOverlay(props, {
    outputLocation: args.out,
    onProgress: args.quiet
      ? undefined
      : (progress) => {
          process.stderr.write(`\rrendering: ${Math.round(progress * 100)}%`);
        },
  });

  if (!args.quiet) process.stderr.write("\n");
  // The machine-readable result goes to stdout so a caller can capture it.
  process.stdout.write(JSON.stringify(result) + "\n");
};
