#!/usr/bin/env node
// Thin launcher for the Chat Highlight card server, like bin.mjs: it runs the
// TypeScript entry through tsx's programmatic loader, so the app can spawn it
// without a build step and without Remotion in its own dependency graph.
import { tsImport } from "tsx/esm/api";

const server = await tsImport("./src/card-server.ts", import.meta.url);

try {
  await server.main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `\n${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
