const NOT_A_ROUTE =
  /(?:\.(?:test|spec)|[-.](?:utils|helpers))\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]/;

/**
 * Fails a test, spec, utils or helpers file, or anything under `__tests__/`,
 * in the files it is turned on for: the public routes folder, where every
 * file becomes a route served to the internet.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow test files and utility modules in the public routes folder.",
    },
    schema: [],
    messages: {
      notARoute:
        "This file is inside apps/local/app/routes, which is public routing: every file there becomes a route served to the internet. Move it next to the feature it serves. Routes hold routes only.",
    },
  },
  create(context) {
    if (!NOT_A_ROUTE.test(context.filename)) return {};
    return {
      Program(node) {
        context.report({ node, messageId: "notARoute" });
      },
    };
  },
};
