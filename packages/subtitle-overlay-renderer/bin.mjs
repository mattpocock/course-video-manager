#!/usr/bin/env node
// Thin launcher so the package is shell-outable without a build step: it runs
// the TypeScript CLI through tsx's programmatic loader.
import { tsImport } from "tsx/esm/api";

const cli = await tsImport("./src/cli.ts", import.meta.url);

try {
  await cli.main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
