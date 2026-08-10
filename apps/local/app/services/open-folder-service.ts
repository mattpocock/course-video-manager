import { Data, Effect } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class OpenFolderError extends Data.TaggedError("OpenFolderError")<{
  cause: unknown;
  message: string;
}> {}

const wslPathToWindows = (
  wslPath: string
): Effect.Effect<string, OpenFolderError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
      return stdout.trim();
    },
    catch: (e) =>
      new OpenFolderError({
        cause: e,
        message: `Failed to convert path: ${e}`,
      }),
  });

export class OpenFolderService extends Effect.Service<OpenFolderService>()(
  "OpenFolderService",
  {
    effect: Effect.gen(function* () {
      const openInExplorer = Effect.fn("openInExplorer")(function* (
        path: string
      ) {
        const windowsPath = yield* wslPathToWindows(path);
        yield* Effect.tryPromise({
          try: async () => {
            await execAsync(`explorer.exe "${windowsPath}"`);
          },
          catch: (e) =>
            new OpenFolderError({
              cause: e,
              message: `Failed to open Explorer: ${e}`,
            }),
        });
      });

      const openInVSCode = Effect.fn("openInVSCode")(function* (path: string) {
        yield* Effect.tryPromise({
          try: async () => {
            await execAsync(`code "${path}"`);
          },
          catch: (e) =>
            new OpenFolderError({
              cause: e,
              message: `Failed to open VS Code: ${e}`,
            }),
        });
      });

      return { openInExplorer, openInVSCode };
    }),
  }
) {}
