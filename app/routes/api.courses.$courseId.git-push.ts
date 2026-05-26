import { Data, Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import { execFileSync } from "node:child_process";

class GitPushError extends Data.TaggedError("GitPushError")<{
  cause: unknown;
  step: "add" | "commit" | "push";
}> {}

export const action = makeAction({
  dump: false,
  effect: ({ params }) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;

      const repo = yield* courseOps.getCourseById(params.courseId!);

      const cwd = repo.filePath!;

      yield* Effect.try({
        try: () =>
          execFileSync("git", ["add", "."], { cwd, encoding: "utf-8" }),
        catch: (cause) => new GitPushError({ cause, step: "add" }),
      });

      yield* Effect.try({
        try: () =>
          execFileSync("git", ["commit", "-m", "Automated updates from CVM"], {
            cwd,
            encoding: "utf-8",
          }),
        catch: (cause) => new GitPushError({ cause, step: "commit" }),
      });

      yield* Effect.try({
        try: () => execFileSync("git", ["push"], { cwd, encoding: "utf-8" }),
        catch: (cause) => new GitPushError({ cause, step: "push" }),
      });

      return { success: true };
    }).pipe(
      Effect.catchTag("GitPushError", (e) =>
        Effect.die(data(`Git ${e.step} failed`, { status: 500 }))
      )
    ),
});
