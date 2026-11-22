// The repo's own Oxlint plugin. Each rule is one file in `rules/`, written
// against the ESLint v9 rule API, with a RuleTester suite beside it. Register
// a rule here, switch it on in `.oxlintrc.json`, and plant its canary in
// `canary/`.
import noOverloads from "./rules/no-overloads.js";

export default {
  meta: { name: "local" },
  rules: {
    "no-overloads": noOverloads,
  },
};
