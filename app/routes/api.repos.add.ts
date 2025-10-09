import { RepoParserService } from "@/services/repo-parser";
import type { Route } from "./+types/api.repos.add";
import { Console, Effect, Schema } from "effect";
import { layerLive } from "@/services/layer";
import { DBService } from "@/services/db-service";
import { withDatabaseDump } from "@/services/dump-service";

const addRepoSchema = Schema.Struct({
  name: Schema.String,
  repoPath: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formDataObject = Object.fromEntries(formData);

  return await Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(addRepoSchema)(formDataObject);

    const repoParserService = yield* RepoParserService;

    const db = yield* DBService;

    const parsedSections = yield* repoParserService.parseRepo(result.repoPath);
    console.log(parsedSections);

    const repo = yield* db.createRepo({
      filePath: result.repoPath,
      name: result.name,
    });

    const sections = yield* db.createSections(repo.id, parsedSections);

    yield* Effect.forEach(sections, (section, index) =>
      Effect.forEach(parsedSections[index]!.lessons, (lesson) =>
        db.createLessons(section.id, [lesson])
      )
    );

    return {
      id: repo.id,
    };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => {
      return Console.dir(e, { depth: null });
    }),
    Effect.catchTag("ParseError", (_e) => {
      return Effect.succeed(new Response("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("RepoDoesNotExistError", (_e) => {
      return Effect.succeed(
        new Response("Repo path does not exist locally", { status: 404 })
      );
    }),
    Effect.catchAll((_e) => {
      return Effect.succeed(
        new Response("Internal server error", { status: 500 })
      );
    }),
    Effect.provide(layerLive),
    Effect.runPromise
  );
};
