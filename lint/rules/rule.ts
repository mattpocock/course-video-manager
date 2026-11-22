import type { RuleTester } from "oxlint/plugins-dev";

/** The shape of a rule, as Oxlint's RuleTester takes it. */
export type Rule = Parameters<RuleTester["run"]>[1];
