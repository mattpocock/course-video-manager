import type { RuleTester } from "oxlint/plugins-dev";

/** The shape of a rule, as Oxlint's RuleTester takes it. */
export type Rule = Parameters<RuleTester["run"]>[1];

/** What a rule's `create` returns. */
export type Visitor = ReturnType<NonNullable<Rule["create"]>>;

/** The node a visitor for `K` receives. */
export type NodeOf<K extends keyof Visitor> = Parameters<
  NonNullable<Visitor[K]>
>[0];
