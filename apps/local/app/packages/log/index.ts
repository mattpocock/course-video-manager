/**
 * The log package: the one owner of `console` in plain TypeScript in
 * apps/local. `log.debug` and `log.info` write to stdout, `log.warn` and
 * `log.error` to stderr. Effect code uses `Effect.log*`; the CLI writes its
 * output through `CliOutput`.
 */
export { log } from "./lib/log";
