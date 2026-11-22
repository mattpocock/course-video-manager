import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lintProbes, ROOT } from "./lint-probe.ts";

const PROBE = "export const loadModule = () => 1;\n";
const FILES = {
  "apps/local/app/features/probe/probe.ts": PROBE,
  "apps/local/app/features/probe/probe.test.ts": PROBE,
  "packages/core/probe.ts": PROBE,
};
const GLOSSARY = readFileSync(path.join(ROOT, "GLOSSARY.md"), "utf8");

const glossaryHits = (glossary?: string) => {
  const probes = lintProbes(FILES, { glossary });
  afterAll(probes.remove);
  return probes.diagnostics.filter((d) => d.code === "local(glossary-terms)");
};

describe("local/glossary-terms in the repo's config", () => {
  const hits = glossaryHits();
  const afterEdit = glossaryHits(
    GLOSSARY.replace("_Avoid_: Module, Unit", "_Avoid_: Unit")
  );

  it.each(Object.keys(FILES))("fails an avoided word in %s", (file) => {
    expect(hits.filter((d) => d.filename === file)).toEqual([
      expect.objectContaining({
        severity: "error",
        message:
          "'loadModule' uses 'Module', which GLOSSARY.md says to avoid. Use 'Section'.",
      }),
    ]);
  });

  it("reads the repo's GLOSSARY.md, so editing it changes what fails", () => {
    expect(GLOSSARY).toContain("_Avoid_: Module, Unit");
    expect(afterEdit).toEqual([]);
  });
});
