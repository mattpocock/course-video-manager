import { nameReferences } from "./names.ts";
import { isResponseBodyCast } from "./response-casts.ts";

const STREAMS = new Set(["createReadStream"]);

const WHY =
  "Use webFileStream from @/services/web-file-stream.server. It converts with Readable.toWeb, so the body is already a web stream and undici never reaches for the async-iterable wrapper that crashes on a cancelled request (#1722): its close throws from a microtask with nothing to catch it, and takes the whole server down. Its own comment has the detail.";

/**
 * Fails every `createReadStream`, and an `as any` or `as unknown as` inside
 * the arguments of `new Response(...)`, because a file reaches a Response
 * through `webFileStream` and no other way.
 *
 * @type {import("./rule.ts").Rule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Node read streams and casts in a Response body: a file reaches a Response through webFileStream.",
    },
    schema: [],
    messages: {
      stream: `A Node read stream, which a file must not reach a Response through. ${WHY}`,
      cast: `A cast inside new Response(...): the cast is the only reason a Node stream body type-checks. ${WHY}`,
    },
  },
  create(context) {
    return {
      ...nameReferences(STREAMS, (node) => {
        context.report({ node, messageId: "stream" });
      }),
      TSAsExpression(node) {
        if (isResponseBodyCast(node))
          context.report({ node, messageId: "cast" });
      },
      TSTypeAssertion(node) {
        if (isResponseBodyCast(node))
          context.report({ node, messageId: "cast" });
      },
    };
  },
};
