/**
 * The env package: the one owner of `process.env` in plain TypeScript in
 * apps/local. `readEnv` reads one variable; the rest is the repo-root `.env`
 * reader, which every `cvm` setting resolves through. Effect code reads
 * configuration with `Config` instead.
 */
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
