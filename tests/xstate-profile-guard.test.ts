import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, RULES, type Rule } from "../scripts/check-xstate-profile";

const ROOT = path.resolve(import.meta.dirname, "..");
const MACHINE = "apps/local/app/features/some/thing-machine.ts";
const HOOK = "apps/local/app/features/some/use-thing.ts";
const PANEL = "apps/local/app/features/some/thing-panel.tsx";

const rulesOf = (file: string, source: string) =>
  check(file, source).map((h) => h.rule);

/** A machine in the profile; each test bends one part of it. */
const machine = (
  o: {
    imports?: string;
    setup?: string;
    root?: string;
    idle?: string;
    body?: string;
  } = {}
) => `
import { setup, types } from "xstate";
${o.imports ?? ""}
const s = setup({
  schemas: { context: types<{ n: number }>(), events: { go: types<{}>() } },
  actions: { log: (_: { n: number }) => {} },
  states: { idle: { schemas: { context: types<{ n: number }>() } }, busy: {} },
  ${o.setup ?? ""}
});
${o.body ?? ""}
export const thingMachine = s.createMachine({
  id: "thing",
  context: { n: 0 },
  initial: "idle",
  on: { go: ({ context }) => ({ context: { n: context.n + 1 } }) },
  ${o.root ?? ""}
  states: {
    idle: {
      on: {
        go: ({ actions }, enq) => {
          enq(actions.log, { n: 1 });
          enq.raise({ type: "go" });
          return { target: "busy" };
        },
      },
      ${o.idle ?? ""}
    },
    busy: { description: "Busy", after: { 100: () => ({ target: "idle" }) } },
  },
});
`;

const ok = (file: string, source: string) =>
  expect(check(file, source)).toEqual([]);
const fails = (rule: Rule, file: string, source: string) =>
  expect(rulesOf(file, source)).toEqual([rule]);

describe("the profile's own machine", () => {
  it("passes every rule", () => ok(MACHINE, machine()));

  it("is out of scope outside apps/local/app, and in tests", () => {
    const bad = machine({ idle: "entry: () => {}," });
    expect(check("packages/core/thing-machine.ts", bad)).toEqual([]);
    expect(
      check("apps/local/app/features/some/thing-machine.test.ts", bad)
    ).toEqual([]);
  });
});

describe("machine-file", () => {
  it("allows setup in a *-machine.ts file and React in a hook", () => {
    ok(MACHINE, machine());
    ok(
      HOOK,
      `import { useActorRef } from "@xstate/react";\nimport { useEffect } from "react";\nexport const useThing = () => useActorRef(m);`
    );
  });
  it("fails setup outside a machine file", () =>
    fails(
      "machine-file",
      PANEL,
      `import { setup } from "xstate";\nsetup({});`
    ));
  it("fails React or @xstate/react in a machine file", () => {
    fails(
      "machine-file",
      MACHINE,
      machine({ imports: `import { useEffect } from "react";` })
    );
    fails(
      "machine-file",
      MACHINE,
      machine({ imports: `import { useSelector } from "@xstate/react";` })
    );
  });
});

describe("setup-shape", () => {
  it("allows schemas.input and internalEvents", () =>
    ok(
      MACHINE,
      machine().replace(
        "schemas: { context",
        "schemas: { input: types<{}>(), internalEvents: {}, context"
      )
    ));
  it("fails guards, actors or delays on setup", () => {
    fails("setup-shape", MACHINE, machine({ setup: "guards: {}," }));
    fails("setup-shape", MACHINE, machine({ setup: "actors: {}," }));
  });
  it("fails schemas.emitted, and a contract with more than schemas.context", () => {
    fails(
      "setup-shape",
      MACHINE,
      machine().replace("schemas: { context", "schemas: { emitted: {}, context")
    );
    fails(
      "setup-shape",
      MACHINE,
      machine().replace("busy: {} }", "busy: { type: 'final' } }")
    );
    fails(
      "setup-shape",
      MACHINE,
      machine().replace(
        "busy: {} }",
        "busy: { schemas: { input: types<{}>() } } }"
      )
    );
  });
});

describe("state-shape", () => {
  it("allows on, after and description", () => ok(MACHINE, machine()));
  it("fails entry, exit, invoke and always on a state", () => {
    for (const key of [
      "entry: () => {},",
      "exit: () => {},",
      "invoke: { src: 'x' },",
      "always: () => {},",
    ])
      fails("state-shape", MACHINE, machine({ idle: key }));
  });
  it("fails anything else on the machine", () => {
    fails("state-shape", MACHINE, machine({ root: "entry: () => {}," }));
    fails("state-shape", MACHINE, machine({ root: "type: 'parallel'," }));
  });
});

describe("flat-states (#5921 workaround)", () => {
  it("allows sibling targets", () => ok(MACHINE, machine()));
  it("fails a state with child states, in the machine or its contract", () => {
    fails("flat-states", MACHINE, machine({ idle: "states: { a: {} }," }));
    fails(
      "flat-states",
      MACHINE,
      machine().replace("busy: {} }", "busy: { states: { a: {} } } }")
    );
  });
  it("fails a path or #id target", () => {
    fails(
      "flat-states",
      MACHINE,
      machine().replace('target: "busy"', 'target: "busy.inner"')
    );
    fails(
      "flat-states",
      MACHINE,
      machine().replace('target: "busy"', 'target: "#busy"')
    );
  });
});

describe("transition-function", () => {
  it("allows a function, a named handler and a handler factory", () => {
    ok(
      MACHINE,
      machine({ body: "const h = () => undefined;", root: "" }).replace(
        "on: { go: ({ context })",
        "on: { go: h, stop: make('x'), run: function () {}, other: ({ context })"
      )
    );
  });
  it("fails an object, a string or an array", () => {
    fails(
      "transition-function",
      MACHINE,
      machine({ idle: "" }).replace(
        'after: { 100: () => ({ target: "idle" }) }',
        'after: { 100: { target: "idle" } }'
      )
    );
    fails(
      "transition-function",
      MACHINE,
      machine().replace(
        "on: { go: ({ context })",
        'on: { stop: "idle", go: ({ context })'
      )
    );
    fails(
      "transition-function",
      MACHINE,
      machine().replace(
        "on: { go: ({ context })",
        "on: { stop: [], go: ({ context })"
      )
    );
  });
});

describe("literal-target", () => {
  it("allows a string literal", () => ok(MACHINE, machine()));
  it("fails a variable or an expression", () => {
    fails(
      "literal-target",
      MACHINE,
      machine().replace('target: "busy"', "target: next")
    );
    fails(
      "literal-target",
      MACHINE,
      machine().replace('target: "busy"', "target: `bu${'sy'}`")
    );
  });
});

describe("named-effects", () => {
  it("allows enq(actions.x, params), enq(actions['x']) and enq.raise(event)", () => {
    ok(
      MACHINE,
      machine().replace(
        "enq(actions.log, { n: 1 });",
        'enq(actions.log, { n: 1 }); enq(actions["log"], { n: 2 });'
      )
    );
  });
  it("fails an inline effect", () =>
    fails(
      "named-effects",
      MACHINE,
      machine().replace(
        "enq(actions.log, { n: 1 });",
        "enq(() => console.log(1));"
      )
    ));
  it("fails every other enq method, and raise with options", () => {
    for (const call of [
      "enq.sendTo(ref, { type: 'x' });",
      "enq.emit({ type: 'x' });",
      "enq.spawn('x');",
      "enq.log('x');",
      "enq.cancel('x');",
      "enq.raise({ type: 'go' }, { delay: 5 });",
    ])
      fails(
        "named-effects",
        MACHINE,
        machine().replace("enq(actions.log, { n: 1 });", call)
      );
  });
});

describe("binding", () => {
  const hook = (body: string) =>
    `import { useActorRef, useSelector } from "@xstate/react";\n${body}`;
  it("allows useActorRef and provide in a use-*.ts hook, and a two-argument useSelector anywhere", () => {
    ok(
      HOOK,
      hook(
        "export const useThing = () => useActorRef(thingMachine.provide({ actions: {} }));"
      )
    );
    ok(
      PANEL,
      hook("export const P = () => useSelector(actor, (s) => s.context.n);")
    );
  });
  it("fails useActorRef outside a hook", () =>
    fails(
      "binding",
      PANEL,
      hook("export const P = () => useActorRef(thingMachine);")
    ));
  it("fails a useSelector compare", () =>
    fails(
      "binding",
      PANEL,
      hook("export const P = () => useSelector(actor, (s) => s, Object.is);")
    ));
  it("fails a machine provided away from its useActorRef", () =>
    fails(
      "binding",
      PANEL,
      hook("export const m = thingMachine.provide({ actions: {} });")
    ));
  it("leaves other libraries' useSelector and provide alone", () =>
    ok(
      PANEL,
      `import { useSelector } from "react-redux";\nimport "xstate";\nuseSelector(a, b, c); Effect.provide(layer);`
    ));
});

describe("the real PoC and the fixtures", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const real = "apps/local/app/features/video-editor/cvm-recorder-machine.ts";

  it("the CVM recorder's machine, hook and selector pass", () => {
    for (const file of [
      real,
      "apps/local/app/features/video-editor/use-cvm-recorder.ts",
      "apps/local/app/features/video-editor/use-cvm-recorder-selector.ts",
      "apps/local/app/features/video-editor/video-editor.tsx",
    ])
      expect(check(file, read(file)), file).toEqual([]);
  });

  it("the CVM recorder's machine fails once it is bent, so the guard reads it", () => {
    const source = read(real);
    const bent = source.replace(
      'target: "stopping"',
      'target: "following.stopping"'
    );
    expect(bent).not.toBe(source);
    expect(rulesOf(real, bent)).toContain("flat-states");
  });

  it("the machine fixture breaks each machine rule once, with its message", () => {
    const hits = check(
      "apps/local/app/features/bad/bad-machine.ts",
      read("tests/fixtures/xstate-profile/violations-machine.ts.txt")
    );
    expect(hits.map((h) => h.rule).sort()).toEqual(
      RULES.filter((r) => r !== "binding").sort()
    );
    expect(hits.map((h) => h.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports no React"),
        expect.stringContaining(
          "setup takes `schemas`, `actions` and `states`"
        ),
        expect.stringContaining(
          "effects belong to the transition that causes them"
        ),
        expect.stringContaining("#5921"),
        expect.stringContaining("is a transition function"),
        expect.stringContaining("`target` is a string literal"),
        expect.stringContaining("`enq(actions.name, params)`"),
      ])
    );
  });

  it("the binding fixture breaks the binding rule three ways", () => {
    const hits = check(
      "apps/local/app/features/bad/bad-panel.tsx",
      read("tests/fixtures/xstate-profile/violations-binding.tsx.txt")
    );
    expect(hits.map((h) => h.rule)).toEqual(["binding", "binding", "binding"]);
    expect(hits.map((h) => h.message).join("\n")).toMatch(
      /use-\*\.ts[\s\S]*no compare[\s\S]*where it runs/
    );
  });

  it("the import fixture fails oxlint with the repo's config, once per ban", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xstate-profile-"));
    const file = path.join(dir, "violations.ts");
    copyFileSync(
      path.join(
        ROOT,
        "tests/fixtures/xstate-profile/violations-imports.ts.txt"
      ),
      file
    );
    let output = "";
    try {
      execFileSync(
        path.join(ROOT, "node_modules/.bin/oxlint"),
        ["-c", path.join(ROOT, ".oxlintrc.json"), file],
        { encoding: "utf8" }
      );
    } catch (error) {
      output = String((error as { stdout?: string }).stdout);
    }
    const bans = output.match(/no-restricted-imports/g) ?? [];
    expect(bans).toHaveLength(3);
    expect(output).toContain(
      "a machine is setup({ schemas, actions, states }).createMachine(...)"
    );
    expect(output).toContain("never the whole snapshot");
    expect(output).toContain(
      "import only setup, types, transition, initialTransition and isUnhandled"
    );
  });

  it("is wired into the pre-commit hook and check:static, which CI runs", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:static"]).toContain(
      "node scripts/check-xstate-profile.ts --all"
    );
    expect(read(".husky/pre-commit")).toContain(
      "pnpm run check:xstate-profile"
    );
    expect(read(".github/workflows/test.yml")).toContain(
      "pnpm run check:static"
    );
  });
});
