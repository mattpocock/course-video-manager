import { Layer, ManagedRuntime } from "effect";
import { ensureApiConfig } from "./env";
import { makeRemoteLayer } from "./rpc-layer";

/**
 * Service layer for the `cvm` CLI.
 *
 * ONE TRANSPORT, and it is HTTP. Every verb group — course, version, section,
 * lesson, video, clip, beat, pitch, deliverable, search — is provided by the
 * deployed API (`apps/remote`) over a bearer-authenticated connection. No
 * Postgres connection string is involved anywhere in this process, so `cvm`
 * behaves identically on the author's machine and on a box that has only a
 * token. That is deliberate: a second in-process path for local use would be
 * the path least exercised, on the machine least watched.
 *
 * The services keep the same TAGS and the same SIGNATURES they had when they
 * ran in-process, so no command handler knows the work happens elsewhere.
 *
 * WRITES. The CLI is read-mostly, but a handful of write verbs exist (lesson
 * create/update/move, video create/move/update, clip update/move/delete,
 * pitch and beat authoring, deliverable create/update/archive). Field edits (a
 * title, a link) go through the DB-operations services; structural edits
 * (reorder, move) go through CourseWriteService. Both are on the API.
 *
 * Commands that need the MACHINE rather than the data — `cvm file`,
 * `cvm course publish`, `cvm course readiness` — read their domain data through
 * this layer and touch local disk themselves. `publish` additionally builds a
 * database-backed layer inside its own handler, because CoursePublishService
 * pulls in ffmpeg and an OPENAI_API_KEY no read command should have to satisfy.
 * All three are LOCAL-ONLY: they refuse on any other machine, at the front of
 * the command, before any of the above happens (see ./local-only.ts).
 *
 * NOTE: CliOutput is NOT in this layer. It is provided per-run at the program
 * edge so tests can swap in a captured implementation (see ./output.ts and
 * ./main.ts).
 */
export const cliLayer = Layer.suspend(() => {
  // Built on first use, not at module load, so `runCli` gets to check the
  // configuration and print a clean error before this ever runs.
  const config = ensureApiConfig();
  if (!config.ok) throw new Error(config.error.message);
  return makeRemoteLayer({ baseUrl: config.baseUrl, token: config.token });
});

/**
 * The shared runtime every CLI command runs through. Built once. The HTTP
 * client is created lazily on first service use, so this is safe to construct
 * at module load (the environment is ensured before the first run — see
 * ./env.ts and ./main.ts).
 */
export const cliRuntime = ManagedRuntime.make(cliLayer);

/** The full context the runtime provides (every domain service `cvm` uses). */
export type CliServices = ManagedRuntime.ManagedRuntime.Context<
  typeof cliRuntime
>;
