import { describe, expect, it } from "vitest";
import {
  compare,
  measure,
  type Allowlist,
  type Measures,
} from "../scripts/check-frontend-state";

const COMPONENT = "apps/local/app/features/some-feature/some-panel.tsx";

const states = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `const [s${i}, setS${i}] = useState(${i});`
  ).join("\n");

describe("measure: use-state", () => {
  it("counts useState and React.useState calls", () => {
    const m = measure(
      COMPONENT,
      `${states(2)}\nconst [x, setX] = React.useState(0);`
    );
    expect(m["use-state"].count).toBe(3);
  });

  it("ignores test files, files outside apps/local/app and comments", () => {
    const src = `${states(6)}`;
    expect(
      measure("apps/local/app/features/x/panel.test.tsx", src)["use-state"]
        .count
    ).toBe(0);
    expect(measure("packages/core/thing.ts", src)["use-state"].count).toBe(0);
    expect(
      measure(COMPONENT, `// useState(1)\n/* useState(2) */`)["use-state"].count
    ).toBe(0);
  });
});

describe("measure: effect-sets-state", () => {
  it("counts each effect that writes one of the file's own useState setters", () => {
    const m = measure(
      COMPONENT,
      `
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        useEffect(() => { setA(1); setB(2); }, []);
        useLayoutEffect(() => { const off = on("x", () => setB(3)); return off; }, []);
        useEffect(() => { fetchThing().then(setA); }, []);
      `
    );
    expect(m["effect-sets-state"].count).toBe(3);
  });

  it("does not count an effect that only dispatches or calls a prop", () => {
    const m = measure(
      COMPONENT,
      `
        const [a, setA] = useState(0);
        const [state, dispatch] = useEffectReducer(reducer, init, handlers);
        useEffect(() => { dispatch({ type: "window-focused" }); }, []);
        useEffect(() => { props.setOpen(false); }, []);
        const onClick = () => setA(1);
      `
    );
    expect(m["effect-sets-state"].count).toBe(0);
  });
});

describe("measure: whole-store", () => {
  const wholeStore = (src: string) => measure(COMPONENT, src)["whole-store"];

  it.each([
    ["an identity arrow", `useSelector(store, (state) => state);`],
    ["a parenthesised identity", `useSelector(store, (s) => (s));`],
    ["a surface's selector hook", `useCvmRecorderSelector((state) => state);`],
    ["a copy by spread", `useSelector(store, (s) => ({ ...s }));`],
    [
      "a copy by spread, with more",
      `useCvmRecorderSelector((s) => ({ ...s, extra: 1 }));`,
    ],
    ["a block returning it", `useSelector(store, (s) => { return s; });`],
    [
      "a function expression",
      `useSelector(store, function (s) { return s; });`,
    ],
    ["a member call", `Store.useSelector(store, (s) => s);`],
  ])("fails %s", (_name, src) => {
    expect(wholeStore(src)).toEqual({ count: 1, lines: [1] });
  });

  it.each([
    ["a field", `useSelector(store, (s) => s.phase);`],
    ["a named selector", `useSelector(store, stillRound);`],
    ["a selector from the reducer's file", `useCvmRecorderSelector(canStop);`],
    ["a derived value", `useSelector(store, (s) => holdsStillsOf(s, clip));`],
    ["a nested object", `useSelector(store, (s) => ({ ...s.camera }));`],
    [
      "a block returning a field",
      `useSelector(store, (s) => { return s.alert; });`,
    ],
    [
      "a selector with an isEqual",
      `useSelector(store, (s) => ({ a: s.a }), (x, y) => x.a === y.a);`,
    ],
    [
      "a context selector",
      `useContextSelector(VideoEditorContext, (ctx) => ctx);`,
    ],
    ["a snapshot read on press", `const s = store.getSnapshot();`],
  ])("passes %s", (_name, src) => {
    expect(wholeStore(src).count).toBe(0);
  });

  it("counts each offending call, with its line", () => {
    const m = wholeStore(
      `const a = useSelector(store, (s) => s.a);\nconst b = useSelector(store, (s) => s);\nconst c = useCvmRecorderSelector((s) => s);`
    );
    expect(m).toEqual({ count: 2, lines: [2, 3] });
  });

  it("ignores test files", () => {
    expect(
      measure(
        "apps/local/app/features/x/panel.browser.test.tsx",
        `useSelector(store, (s) => s);`
      )["whole-store"].count
    ).toBe(0);
  });

  it("fails any hit: the limit is 0 and there is no allowlist", () => {
    const hit = new Map<string, Measures>([
      [
        COMPONENT,
        {
          "use-state": { count: 0, lines: [] },
          "effect-sets-state": { count: 0, lines: [] },
          "whole-store": { count: 1, lines: [3] },
        },
      ],
    ]);
    const problems = compare(hit, {}, checked, true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("[whole-store]");
    expect(problems[0]).toContain("docs/FRONTEND_STATE.md");
  });
});

const found = (useState: number, effectSetsState = 0) =>
  new Map<string, Measures>([
    [
      COMPONENT,
      {
        "use-state": { count: useState, lines: [] },
        "effect-sets-state": { count: effectSetsState, lines: [] },
        "whole-store": { count: 0, lines: [] },
      },
    ],
  ]);

const allow = (count: number): Allowlist => ({
  "use-state": [{ file: COMPONENT, count, reason: "legacy" }],
});

const checked = new Set([COMPONENT]);

describe("compare", () => {
  it("lets a file sit at or under the limit with no entry", () => {
    expect(compare(found(4, 1), {}, checked, true)).toEqual([]);
  });

  it("fails a new offender and points at the doc", () => {
    const problems = compare(found(5), {}, checked, true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("docs/FRONTEND_STATE.md");
  });

  it("fails an allowlisted file that grows, passes one that holds", () => {
    expect(compare(found(7), allow(7), checked, true)).toEqual([]);
    expect(compare(found(8), allow(7), checked, true)).toHaveLength(1);
  });

  it("only shrinks: a lower count must be written back, and a fixed file deleted", () => {
    const [lower] = compare(found(6), allow(7), checked, true);
    expect(lower).toContain("lower the count to 6");
    const [fixed] = compare(found(3), allow(7), checked, true);
    expect(fixed).toContain("delete the entry");
  });

  it("does not judge an entry for a file it did not measure in staged mode", () => {
    expect(compare(new Map(), allow(7), new Set(), false)).toEqual([]);
    expect(compare(new Map(), allow(7), new Set(), true)).toHaveLength(1);
  });
});
