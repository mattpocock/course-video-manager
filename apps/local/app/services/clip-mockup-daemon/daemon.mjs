#!/usr/bin/env node
/**
 * The launcher `cvm` spawns, detached, to start the Clip Mockup daemon. The
 * daemon's own code is `server.ts`; see `protocol.ts` for why it exists.
 *
 * A PLAIN Node file for the reason `app/cli/bin.mjs` is one: it has to pin
 * tsx to THIS checkout's tsconfig before tsx boots, or the `@/*` path aliases
 * would resolve from wherever the process happened to start. This is the only
 * place the daemon calls process.exit.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH = resolve(here, "../../../tsconfig.json");

const { tsImport } = await import("tsx/esm/api");
const { runClipMockupDaemon } = await tsImport("./server.ts", import.meta.url);

process.exit(await runClipMockupDaemon());
