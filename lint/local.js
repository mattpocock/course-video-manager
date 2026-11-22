/**
 * The repo's own Oxlint plugin, `local`. One rule per file in `rules/`, each
 * with a RuleTester suite beside it and a planted violation in `canary/`.
 */
import noOverloads from "./rules/no-overloads.js";

export default {
  meta: { name: "local" },
  rules: {
    "no-overloads": noOverloads,
  },
};
