import { Config, Effect } from "effect";

export class BackupCoordinatorError {
  readonly _tag = "BackupCoordinatorError";
  constructor(readonly message: string) {}
}

export class BackupCoordinator extends Effect.Service<BackupCoordinator>()(
  "BackupCoordinator",
  {
    effect: Effect.gen(function* () {
      const serverUrl = yield* Config.withDefault(
        Config.string("CVM_SERVER_URL"),
        "http://localhost:5173"
      );

      return {
        ensureServerHealthy: Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${serverUrl}/api/backup/health`, {
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) {
              throw new Error(`health-check returned ${res.status}`);
            }
          },
          catch: () =>
            new BackupCoordinatorError(
              "CVM server is not reachable — refusing write to prevent un-backed-up mutation. " +
                "Start the server and retry."
            ),
        }),

        requestDump: Effect.tryPromise({
          try: async () => {
            await fetch(`${serverUrl}/api/backup/dump`, {
              method: "POST",
              signal: AbortSignal.timeout(5000),
            });
          },
          catch: () =>
            new BackupCoordinatorError(
              "Failed to request backup dump from server"
            ),
        }).pipe(Effect.ignore),
      };
    }),
  }
) {}

export const withBackupCoordination = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | BackupCoordinatorError, R | BackupCoordinator> =>
  Effect.gen(function* () {
    const coordinator = yield* BackupCoordinator;
    yield* coordinator.ensureServerHealthy;
    const result = yield* effect;
    yield* coordinator.requestDump;
    return result;
  });
