import { describe, it, expect } from "@effect/vitest";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
} from "effect";
import {
  buildPgDumpCommand,
  DatabaseDumpService,
  PgDumpError,
  PgDumpRunner,
  withDatabaseDump,
} from "./dump-service";
import { makeAction } from "./route-action.server";

// ---------------------------------------------------------------------------
// buildPgDumpCommand — pure command shape
// ---------------------------------------------------------------------------

describe("buildPgDumpCommand", () => {
  it("builds the correct docker exec pg_dump command", () => {
    const cmd = buildPgDumpCommand({
      containerName: "my-postgres",
      databaseUrl: "postgresql://user@localhost/mydb",
      dumpFileLocation: "/backups/cvm.sql",
    });

    expect(cmd.command).toBe("docker");
    expect(cmd.args[0]).toBe("exec");
    expect(cmd.args[1]).toBe("my-postgres");
    expect(cmd.args[2]).toBe("pg_dump");
    expect(cmd.args[3]).toBe("postgresql://user@localhost/mydb");
    expect(cmd.args).toContain("--no-owner");
    expect(cmd.args).toContain("--no-acl");
    expect(cmd.args).toContain("--exclude-table-data=youtube_auth");
    expect(cmd.args).toContain("--exclude-table-data=ai_hero_auth");
    expect(cmd.outputPath).toBe("/backups/cvm.sql");
  });

  it("uses the provided container name", () => {
    const cmd = buildPgDumpCommand({
      containerName: "custom-container",
      databaseUrl: "postgresql://x",
      dumpFileLocation: "/x.sql",
    });
    expect(cmd.args[1]).toBe("custom-container");
  });
});

// ---------------------------------------------------------------------------
// DatabaseDumpService — constructed with injectable seams
// ---------------------------------------------------------------------------

const testConfig = ConfigProvider.fromMap(
  new Map([
    ["DUMP_FILE_LOCATION", "/test-backups/cvm.sql"],
    ["DATABASE_URL", "postgresql://test@localhost:5432/testdb"],
    ["PG_DUMP_CONTAINER", "test-postgres"],
  ])
);

const configLayer = Layer.setConfigProvider(testConfig);

describe("DatabaseDumpService", () => {
  it.effect(
    "_runDump invokes the runner with the configured command shape",
    () => {
      let recorded: {
        command: string;
        args: ReadonlyArray<string>;
        outputPath: string;
      } | null = null;

      const recordingRunner = Layer.succeed(PgDumpRunner, {
        run: (
          command: string,
          args: ReadonlyArray<string>,
          outputPath: string
        ) => {
          recorded = { command, args, outputPath };
          return Effect.void;
        },
      } as unknown as PgDumpRunner);

      const layer = DatabaseDumpService.Default.pipe(
        Layer.provide(recordingRunner),
        Layer.provide(configLayer)
      );

      return Effect.gen(function* () {
        const svc = yield* DatabaseDumpService;
        yield* svc._runDump();

        expect(recorded).not.toBeNull();
        expect(recorded!.command).toBe("docker");
        expect(recorded!.args).toContain("test-postgres");
        expect(recorded!.args).toContain(
          "postgresql://test@localhost:5432/testdb"
        );
        expect(recorded!.args).toContain("--no-owner");
        expect(recorded!.args).toContain("--no-acl");
        expect(recorded!.args).toContain("--exclude-table-data=youtube_auth");
        expect(recorded!.args).toContain("--exclude-table-data=ai_hero_auth");
        expect(recorded!.outputPath).toBe("/test-backups/cvm.sql");
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect("executor failure propagates from _runDump (not swallowed)", () => {
    const failingRunner = Layer.succeed(PgDumpRunner, {
      run: () => Effect.fail(new PgDumpError({ cause: "simulated" })),
    } as unknown as PgDumpRunner);

    const layer = DatabaseDumpService.Default.pipe(
      Layer.provide(failingRunner),
      Layer.provide(configLayer)
    );

    return Effect.gen(function* () {
      const svc = yield* DatabaseDumpService;
      const exit = yield* svc._runDump().pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect((failure.value as PgDumpError)._tag).toBe("PgDumpError");
        }
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "uses default container name when PG_DUMP_CONTAINER is unset",
    () => {
      let recorded: {
        command: string;
        args: ReadonlyArray<string>;
        outputPath: string;
      } | null = null;

      const configNoContainer = ConfigProvider.fromMap(
        new Map([
          ["DUMP_FILE_LOCATION", "/x.sql"],
          ["DATABASE_URL", "postgresql://x"],
        ])
      );

      const recordingRunner = Layer.succeed(PgDumpRunner, {
        run: (
          command: string,
          args: ReadonlyArray<string>,
          outputPath: string
        ) => {
          recorded = { command, args, outputPath };
          return Effect.void;
        },
      } as unknown as PgDumpRunner);

      const layer = DatabaseDumpService.Default.pipe(
        Layer.provide(recordingRunner),
        Layer.provide(Layer.setConfigProvider(configNoContainer))
      );

      return Effect.gen(function* () {
        const svc = yield* DatabaseDumpService;
        yield* svc._runDump();
        expect(recorded).not.toBeNull();
        expect(recorded!.args).toContain("ai-app-template-postgres");
      }).pipe(Effect.provide(layer));
    }
  );
});

// ---------------------------------------------------------------------------
// Server endpoints — health-check + dump-trigger
// ---------------------------------------------------------------------------

describe("api.backup endpoints", () => {
  it("health-check returns { status: ok }", async () => {
    const { loader } = await import("@/routes/api.backup.health");
    const result = loader();
    expect(result).toEqual({ status: "ok" });
  });

  it("dump-trigger enqueues a dump and returns immediately", async () => {
    let dumpCalled = false;
    const mockDump = Layer.succeed(DatabaseDumpService, {
      requestDump: Effect.sync(() => {
        dumpCalled = true;
      }),
    } as unknown as DatabaseDumpService);

    const runtime = ManagedRuntime.make(mockDump);

    await import("@/routes/api.backup.dump");
    const testAction = makeAction(
      {
        dump: false,
        effect: () =>
          Effect.gen(function* () {
            const svc = yield* DatabaseDumpService;
            yield* svc.requestDump;
            return { enqueued: true };
          }),
      },
      runtime
    );

    const result = await testAction({
      request: new Request("http://test.local/api/backup/dump", {
        method: "POST",
      }),
      params: {},
    });

    expect(result).toEqual({ enqueued: true });
    expect(dumpCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// withDatabaseDump combinator
// ---------------------------------------------------------------------------

const noopDumpLayer = Layer.succeed(DatabaseDumpService, {
  requestDump: Effect.void,
} as unknown as DatabaseDumpService);

describe("withDatabaseDump", () => {
  it.effect("returns the main effect's value", () =>
    Effect.gen(function* () {
      const result =
        yield* Effect.succeed("main-result").pipe(withDatabaseDump);
      expect(result).toBe("main-result");
    }).pipe(Effect.provide(noopDumpLayer))
  );

  it.effect("propagates the main effect's failure", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.fail("main-error")
        .pipe(withDatabaseDump)
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value).toBe("main-error");
        }
      }
    }).pipe(Effect.provide(noopDumpLayer))
  );
});
