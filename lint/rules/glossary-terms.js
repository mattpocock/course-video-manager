import path from "node:path";
import { glossaryOption, readGlossary } from "./glossary.ts";

/** @type {Map<string, import("./glossary.ts").Glossary>} */
const glossaries = new Map();

/** @param {string} file */
const glossaryAt = (file) => {
  const known = glossaries.get(file);
  if (known) return known;
  const read = readGlossary(file);
  glossaries.set(file, read);
  return read;
};

/** @param {readonly string[]} names */
const either = (names) => {
  const quoted = names.map((name) => `'${name}'`);
  const last = quoted.pop();
  return quoted.length === 0 ? `${last}` : `${quoted.join(", ")} or ${last}`;
};

/** @param {{ type: string, name?: unknown }} name */
const isIntrinsic = (name) =>
  name.type === "JSXIdentifier" &&
  typeof name.name === "string" &&
  /^[a-z]|-/.test(name.name);

/**
 * Fails an identifier whose words contain an entry of a glossary's `_Avoid_`
 * lists, and names the glossary term to use instead. JSX names are checked
 * like any identifier, except an intrinsic element's tag and attributes,
 * which are the DOM's names.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow identifiers built from a word or phrase the glossary says to avoid.",
    },
    schema: [
      {
        type: "object",
        properties: { glossary: { type: "string" } },
        required: ["glossary"],
        additionalProperties: false,
      },
    ],
    messages: {
      avoided:
        "'{{identifier}}' uses '{{avoided}}', which {{glossary}} says to avoid. Use {{use}}.",
    },
  },
  create(context) {
    const configured = glossaryOption(context.options);
    const glossary = glossaryAt(path.resolve(context.cwd, configured));
    const reported = new Set();

    /** @param {import("./rule.ts").NodeOf<"Identifier"> | import("./rule.ts").NodeOf<"PrivateIdentifier"> | import("./rule.ts").NodeOf<"JSXIdentifier">} node */
    const check = (node) => {
      if (reported.has(node.range[0])) return;
      reported.add(node.range[0]);
      for (const hit of glossary.hitsIn(node.name)) {
        context.report({
          node,
          messageId: "avoided",
          data: {
            identifier: node.name,
            avoided: hit.avoided,
            glossary: configured,
            use: either(hit.use),
          },
        });
      }
    };

    return {
      Identifier: check,
      PrivateIdentifier: check,
      JSXIdentifier(node) {
        const parent = node.parent;
        if (
          (parent.type === "JSXOpeningElement" ||
            parent.type === "JSXClosingElement") &&
          isIntrinsic(node)
        ) {
          return;
        }
        if (
          parent.type === "JSXAttribute" &&
          parent.parent.type === "JSXOpeningElement" &&
          isIntrinsic(parent.parent.name)
        ) {
          return;
        }
        check(node);
      },
    };
  },
};
