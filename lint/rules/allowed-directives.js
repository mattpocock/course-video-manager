import { readFileSync } from "node:fs";
import path from "node:path";

const DIRECTIVE =
  /^[\s/*]*((?:oxlint|eslint)-disable\S*|@ts-(?:expect-error|ignore|nocheck)|biome-ignore\S*|@effect-diagnostics\S*)(.*)$/s;

export const directiveOf = (comment) => {
  const match = DIRECTIVE.exec(comment);
  if (!match) return undefined;
  return `${match[1]}${match[2]}`.replace(/\s+/g, " ").replace(/[\s*]+$/, "");
};

const allowlists = new Map();

const allowlist = (file) => {
  if (!allowlists.has(file)) {
    const entries = JSON.parse(readFileSync(file, "utf8"));
    allowlists.set(
      file,
      new Set(
        entries
          .filter((entry) => entry.reason?.trim())
          .map((entry) => `${entry.file}\0${entry.directive}`)
      )
    );
  }
  return allowlists.get(file);
};

const toRepoPath = (cwd, file) =>
  path.relative(cwd, file).split(path.sep).join("/");

/**
 * Fails every disable directive, `@ts-expect-error` and Effect diagnostics
 * directive that the allowlist does not name, for that file, with a reason.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow escape-hatch directives that are not on the reviewed allowlist with a reason.",
    },
    schema: [
      {
        type: "object",
        properties: { allowlist: { type: "string" } },
        required: ["allowlist"],
        additionalProperties: false,
      },
    ],
    messages: {
      directive:
        "'{{directive}}' is not in lint/allowed-directives.json for this file. Fix the code instead of silencing the check; an allowlist entry needs a reason and the owner's review.",
    },
  },
  create(context) {
    const allowed = allowlist(
      path.resolve(context.cwd, context.options[0].allowlist)
    );
    const file = toRepoPath(context.cwd, context.filename);
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = directiveOf(comment.value);
          if (directive === undefined) continue;
          if (!allowed.has(`${file}\0${directive}`)) {
            context.report({
              loc: comment.loc,
              messageId: "directive",
              data: { directive },
            });
          }
        }
      },
    };
  },
};
