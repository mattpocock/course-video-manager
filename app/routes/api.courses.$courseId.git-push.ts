import { Console, Effect } from "effect";
import type { Route } from "./+types/api.courses.$courseId.git-push";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { execFileSync } from "node:child_process";

export const action = async (args: Route.ActionArgs) => {
  const repoId = args.params.courseId;

  return Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;

    const repo = yield* courseOps.getCourseById(repoId);

    if (!repo) {
      return Effect.die(data("Repo not found", { status: 404 }));
    }

    const cwd = repo.filePath!;

    // git add .
    yield* Effect.try({
      try: () => execFileSync("git", ["add", "."], { cwd, encoding: "utf-8" }),
      catch: (cause) => new GitPushError({ cause, step: "add" }),
    });

    // git commit
    yield* Effect.try({
      try: () =>
        execFileSync("git", ["commit", "-m", "Automated updates from CVM"], {
          cwd,
          encoding: "utf-8",
        }),
      catch: (cause) => new GitPushError({ cause, step: "commit" }),
    });

    // git push
    yield* Effect.try({
      try: () => execFileSync("git", ["push"], { cwd, encoding: "utf-8" }),
      catch: (cause) => new GitPushError({ cause, step: "push" }),
    });

    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("GitPushError", (e) => {
      return Effect.die(data(`Git ${e.step} failed`, { status: 500 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

import { Data } from "effect";

class GitPushError extends Data.TaggedError("GitPushError")<{
  cause: unknown;
  step: "add" | "commit" | "push";
}> {}
