import fs from "node:fs";
import path from "node:path";
import { readEnv } from "@/packages/env";

/**
 * Loads the repo-root `.env` into `process.env` — as a SIDE EFFECT OF BEING
 * IMPORTED. `run-sidecar.ts` imports it first, before anything else.
 *
 * It has to be an import, not a call in `main()`: ES modules are evaluated
 * before the code that imports them runs, and some of the Sidecar's modules
 * read the environment while they are evaluated (`layer.server.ts` refuses on
 * a missing STORAGE_ROOTS at the top level). Loaded inside `main()`, the
 * `.env` arrived after those modules had already thrown.
 *
 * A variable already set wins: `process.loadEnvFile` never overrides one, so
 * verify-cvm's DATABASE_URL (its clone) is never replaced by `.env`'s.
 *
 * `CVM_SIDECAR_ENV_FILE` names a different file; the entry-point test uses it
 * to start a Sidecar against a `.env` of its own.
 */
const envFile =
  readEnv("CVM_SIDECAR_ENV_FILE") ||
  path.join(path.resolve(import.meta.dirname, "../../.."), ".env");

if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
