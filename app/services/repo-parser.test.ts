import { describe, expect, it } from "vitest";

import {
  getSectionAndLessonNumberFromPath,
  notFound,
  RepoParserService,
} from "./repo-parser";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";

describe("getSectionAndLessonNumberFromPath", () => {
  it.each([
    [
      "001-foo/003-example",
      {
        sectionNumber: 1,
        lessonNumber: 3,
        lessonPathWithNumber: "003-example",
        sectionPathWithNumber: "001-foo",
      },
    ],
    [
      "001-foo/003-example/api/foo.ts",
      {
        sectionNumber: 1,
        lessonNumber: 3,
        lessonPathWithNumber: "003-example",
        sectionPathWithNumber: "001-foo",
      },
    ],
    [
      "001-wonderful-awesome-thing/003.5-example-of-a-wonderful-awesome-thing",
      {
        sectionNumber: 1,
        lessonNumber: 3.5,
        lessonPathWithNumber: "003.5-example-of-a-wonderful-awesome-thing",
        sectionPathWithNumber: "001-wonderful-awesome-thing",
      },
    ],
    ["foo", notFound],
    [
      "001-foo/003-example/foo",
      {
        sectionNumber: 1,
        lessonNumber: 3,
        lessonPathWithNumber: "003-example",
        sectionPathWithNumber: "001-foo",
      },
    ],
  ])(
    "should return the section and lesson number from a path",
    (path, expected) => {
      const result = getSectionAndLessonNumberFromPath(path);
      expect(result).toEqual(expected);
    }
  );
});

describe("parseRepo", () => {
  it.each([
    [["foo"], []],
    [
      ["001-foo", "002-bar", "001-foo/003-example", "002-bar/004-example"],
      [
        {
          sectionNumber: 1,
          sectionPathWithNumber: "001-foo",
          lessons: [
            {
              lessonNumber: 3,
              lessonPathWithNumber: "003-example",
            },
          ],
        },
        {
          sectionNumber: 2,
          sectionPathWithNumber: "002-bar",
          lessons: [
            {
              lessonNumber: 4,
              lessonPathWithNumber: "004-example",
            },
          ],
        },
      ],
    ],
    [["foo/bar/baz"], []],
  ])("should parse a repo", async (files: string[], expected) => {
    const result = await Effect.gen(function* () {
      const repoParserService = yield* RepoParserService;

      const repo = yield* repoParserService.parseRepo("");

      return repo;
    }).pipe(
      Effect.provide(RepoParserService.DefaultWithoutDependencies),
      Effect.provide(
        FileSystem.layerNoop({
          readDirectory: () => Effect.succeed(files),
          exists: () => Effect.succeed(true),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual(expected);
  });
});
