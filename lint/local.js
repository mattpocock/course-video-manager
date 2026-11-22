/**
 * The repo's own Oxlint plugin, `local`. One rule per file in `rules/`, each
 * with a RuleTester suite beside it and a planted violation in `canary/`.
 */
import allowedDirectives from "./rules/allowed-directives.js";
import fsWrites from "./rules/fs-writes.js";
import noOverloads from "./rules/no-overloads.js";
import noUnsafeAs from "./rules/no-unsafe-as.js";

export default {
  meta: { name: "local" },
  rules: {
    "allowed-directives": allowedDirectives,
    "fs-writes": fsWrites,
    "no-overloads": noOverloads,
    "no-unsafe-as": noUnsafeAs,
  },
};
