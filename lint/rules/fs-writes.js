import { unguardedWrite } from "./fs-writes-calls.ts";

/** @type {import("./rule.ts").Rule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow file-system writes, deletes, renames and copies whose destination did not pass a path guard.",
    },
    schema: [],
    messages: {
      unguarded:
        "{{op}} on a path that did not pass assertUnder. A path the app did not build itself (an absolute filePath read from the database, a path out of a request) must pass a guard before anything writes, deletes, renames or copies onto it: resolve it with assertUnder / assertUnderEffect (apps/local/app/services/assert-under.ts), or a resolver that calls it, against the env-configured folder that kind of file lives in, assign the result to a variable, and write to that: `const target = yield* assertUnderEffect(getVideoFilesBaseDir(), row.filePath); yield* fs.writeFile(target, bytes);`. Never raise its count in lint-baseline.json.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const op = unguardedWrite(context, node);
        if (op) context.report({ node, messageId: "unguarded", data: { op } });
      },
    };
  },
};

export default rule;
