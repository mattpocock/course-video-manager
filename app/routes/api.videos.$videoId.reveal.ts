import { Effect } from "effect";
import { data } from "react-router";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeAction } from "@/services/route-action.server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const wslPathToWindows = (wslPath: string): Effect.Effect<string, Error> => {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
      return stdout.trim();
    },
    catch: (e) => new Error(`Failed to convert path: ${e}`),
  });
};

const revealInExplorer = (windowsPath: string): Effect.Effect<void, Error> => {
  return Effect.async<void, Error>((resume) => {
    const command = `powershell.exe -c "explorer.exe '/select,\\"${windowsPath}\\"'"`;
    exec(command, (error) => {
      if (error && typeof error.code === "string") {
        resume(
          Effect.fail(new Error(`Failed to reveal file: ${error.message}`))
        );
      } else {
        resume(Effect.succeed(undefined));
      }
    });
  });
};

export const action = makeAction({
  dump: false,
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishService;
      const exportPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!exportPath) {
        return yield* Effect.die(
          data("No exported file for this video", { status: 404 })
        );
      }

      const windowsPath = yield* wslPathToWindows(exportPath);
      yield* revealInExplorer(windowsPath);

      return { success: true };
    }),
});
