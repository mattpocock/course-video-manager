import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import routesFolder from "./routes-folder.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ROUTES = "apps/local/app/routes";
const code = "export const x = 1;";
const notARoute = { messageId: "notARoute" };

const valid = (name: string) => ({ code, filename: `${ROUTES}/${name}` });
const invalid = (name: string) => ({
  code,
  filename: `${ROUTES}/${name}`,
  errors: [notARoute],
});

new RuleTester().run("routes-folder", routesFolder, {
  valid: [
    valid("_app._index.tsx"),
    valid("_app.courses.$courseId._index.tsx"),
    valid("api.videos.$videoId.stream.ts"),
    valid("api.test-runs.ts"),
    valid("api.utils-check.ts"),
    valid("_app.helpers.$id.tsx"),
    valid("contest.tsx"),
    valid("specs.tsx"),
    valid("api.tests.ts"),
    valid("_app.utils.tsx.bak.ts"),
  ],
  invalid: [
    invalid("api.videos.test.ts"),
    invalid("_app.courses.test.tsx"),
    invalid("api.videos.spec.ts"),
    invalid("_app.index.spec.tsx"),
    invalid("api.videos.browser.test.tsx"),
    invalid("video-utils.ts"),
    invalid("video.utils.tsx"),
    invalid("api-helpers.ts"),
    invalid("api.helpers.tsx"),
    invalid("__tests__/api.videos.ts"),
    invalid("__tests__/nested/fixture.tsx"),
    invalid("nested/__tests__/x.ts"),
    invalid("api.videos.test.js"),
    invalid("video.utils.mjs"),
  ],
});
