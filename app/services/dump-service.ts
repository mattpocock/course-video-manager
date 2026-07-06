import { Config, Effect, Queue } from "effect";

export class PgDumpError {
  readonly _tag = "PgDumpError";
  constructor(readonly params: { cause: unknown }) {}
}

export class PgDumpRunner extends Effect.Service<PgDumpRunner>()(
  "PgDumpRunner",
  {
    effect: Effect.gen(function* () {
      return {
        run: (
          command: string,
          args: ReadonlyArray<string>,
          outputPath: string
        ): Effect.Effect<void, PgDumpError> =>
          Effect.tryPromise({
            try: async () => {
              const { spawn } = await import("node:child_process");
              const { createWriteStream } = await import("node:fs");
              return new Promise<void>((resolve, reject) => {
                const child = spawn(command, [...args]);
                const stream = createWriteStream(outputPath);
                child.stdout.pipe(stream);
                let stderr = "";
                child.stderr.on("data", (chunk: Buffer) => {
                  stderr += chunk.toString();
                });
                child.on("close", (code: number | null) => {
                  if (code === 0) resolve();
                  else
                    reject(
                      new Error(`pg_dump exited with code ${code}: ${stderr}`)
                    );
                });
                child.on("error", reject);
              });
            },
            catch: (err) => new PgDumpError({ cause: err }),
          }),
      };
    }),
  }
) {}

export const buildPgDumpCommand = (config: {
  readonly containerName: string;
  readonly databaseUrl: string;
  readonly dumpFileLocation: string;
}) => ({
  command: "docker",
  args: [
    "exec",
    config.containerName,
    "pg_dump",
    config.databaseUrl,
    "--no-owner",
    "--no-acl",
    "--exclude-table-data=youtube_auth",
    "--exclude-table-data=ai_hero_auth",
  ],
  outputPath: config.dumpFileLocation,
});

export class DatabaseDumpService extends Effect.Service<DatabaseDumpService>()(
  "DatabaseDumpService",
  {
    effect: Effect.gen(function* () {
      const runner = yield* PgDumpRunner;
      const DUMP_FILE_LOCATION = yield* Config.string("DUMP_FILE_LOCATION");
      const CONTAINER_NAME = yield* Config.withDefault(
        Config.string("PG_DUMP_CONTAINER"),
        "ai-app-template-postgres"
      );
      const DATABASE_URL = yield* Config.string("DATABASE_URL");

      const _buildCommand = () =>
        buildPgDumpCommand({
          containerName: CONTAINER_NAME,
          databaseUrl: DATABASE_URL,
          dumpFileLocation: DUMP_FILE_LOCATION,
        });

      const _runDump = Effect.fn("dump")(function* () {
        const { command, args, outputPath } = _buildCommand();
        yield* runner.run(command, args, outputPath);
      });

      // Sliding(1) coalesces bursts: while a dump is running, additional
      // requests collapse into a single trailing dump.
      const queue = yield* Queue.sliding<void>(1);

      yield* Effect.forkDaemon(
        Queue.take(queue).pipe(
          Effect.zipRight(
            _runDump().pipe(
              Effect.tapError(() =>
                Effect.sync(() => {
                  console.error(
                    "FATAL: pg_dump failed — crashing server to prevent silent backup rot"
                  );
                  process.exit(1);
                })
              )
            )
          ),
          Effect.forever
        )
      );

      const requestDump = Queue.offer(queue, undefined).pipe(Effect.asVoid);

      return {
        requestDump,
        _runDump,
      };
    }),
  }
) {}

export const withDatabaseDump = Effect.tap(() =>
  Effect.gen(function* () {
    const dbService = yield* DatabaseDumpService;
    yield* dbService.requestDump;
  })
);
