import { nameReferences } from "./names.ts";

const CJS_PATHS = new Set(["__dirname", "__filename"]);

/**
 * Fails every `__dirname` and `__filename`, including a locally declared ESM
 * shim, because this is an ESM project with `import.meta.dirname` and
 * `import.meta.filename` built in.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the CommonJS path globals __dirname and __filename, and shims named after them.",
    },
    schema: [],
    messages: {
      cjs: 'CommonJS path global in an ESM project ("type": "module"). Use import.meta.dirname instead of __dirname, and import.meta.filename instead of __filename; no shim is needed.',
    },
  },
  create(context) {
    return nameReferences(CJS_PATHS, (node) => {
      context.report({ node, messageId: "cjs" });
    });
  },
};
