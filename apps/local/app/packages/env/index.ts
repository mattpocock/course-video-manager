/**
 * The env package: the one owner of `process.env` in plain TypeScript in
 * apps/local. `readEnv` reads one variable, named by an `EnvName`: a key
 * `.env.example` documents, listed in `ENV_NAMES`. The rest is the repo-root
 * `.env` reader, which every `cvm` setting resolves through. Effect code reads
 * configuration with `Config` instead.
 */
export { ENV_NAMES, type EnvName } from "./lib/env-names";
export { readEnv } from "./lib/read-env";
export {
  envEntries,
  findRepoRoot,
  installLocationRepoRoot,
  loadRepoEnv,
  readEnvValue,
  repoEnvPath,
  resolveRepoEnvValue,
} from "./lib/repo-env";
