import path from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import glossaryTerms from "./glossary-terms.js";

RuleTester.describe = describe;
RuleTester.it = it;

const GLOSSARY = path.join(import.meta.dirname, "fixtures/glossary.md");
const options = [{ glossary: GLOSSARY }];

const avoided = (identifier: string, word: string, use: string) => ({
  message: `'${identifier}' uses '${word}', which ${GLOSSARY} says to avoid. Use ${use}.`,
});

const valid = (code: string, filename = "probe.tsx") => ({
  code,
  filename,
  options,
});

const invalid = (
  code: string,
  errors: ReturnType<typeof avoided>[],
  filename = "probe.tsx"
) => ({ code, filename, options, errors });

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("glossary-terms", glossaryTerms, {
  valid: [
    valid("const section = 1;"),
    valid("const clipSection = 1;"),
    valid("const courseVersion = 1;"),
    valid("type CourseVersion = { id: string };"),
    valid("const preservedSnapshot = 1;"),
    valid("const PRESERVED_SNAPSHOT_ID = 1;"),
    valid("const markedTodo = true;"),
    valid("const speakerFootage = 1;"),
    valid("const overlayTemplate = 1;"),
    valid("const unrelated = 1;"),
    valid("const modules = [];"),
    valid("const submodule = 1;"),
    valid("const deleted = 1;"),
    valid("const s = 'module';"),
    valid("const s = `revision ${1}`;"),
    valid("// rollback the module\nconst x = 1;"),
    valid("const o = { 'module': 1 };"),
    valid("const v = <track kind='captions' />;"),
    valid("const v = <div unit='x' />;"),
  ],
  invalid: [
    invalid("const module = 1;", [avoided("module", "Module", "'Section'")]),
    invalid("const loadModule = 1;", [
      avoided("loadModule", "Module", "'Section'"),
    ]),
    invalid("class ModuleList {}", [
      avoided("ModuleList", "Module", "'Section'"),
    ]),
    invalid("const module_list = 1;", [
      avoided("module_list", "Module", "'Section'"),
    ]),
    invalid("const MODULE_COUNT = 1;", [
      avoided("MODULE_COUNT", "Module", "'Section'"),
    ]),
    invalid("const get$module = 1;", [
      avoided("get$module", "Module", "'Section'"),
    ]),
    invalid("const HTMLModule = 1;", [
      avoided("HTMLModule", "Module", "'Section'"),
    ]),
    invalid("const revision2 = 1;", [
      avoided("revision2", "Revision", "'CourseVersion'"),
    ]),
    invalid("const deleteVersion = 1;", [
      avoided("deleteVersion", "Delete version", "'Discard'"),
    ]),
    invalid("const backupCopyPath = 1;", [
      avoided("backupCopyPath", "Backup copy", "'Preserved Snapshot'"),
    ]),
    invalid("const currentVersion = 1;", [
      avoided("currentVersion", "Version", "'CourseVersion'"),
    ]),
    invalid("const takeSnapshot = 1;", [
      avoided("takeSnapshot", "Snapshot", "'Submit'"),
    ]),
    invalid("const TODOFlag = 1;", [
      avoided("TODOFlag", "TODO flag", "'Marked Ready / Marked TODO'"),
    ]),
    invalid("const trackId = 1;", [
      avoided("trackId", "Track", "'Layer' or 'Speaker Footage'"),
    ]),
    invalid("const localRecording = 1;", [
      avoided("localRecording", "Local recording", "'Speaker Footage'"),
    ]),
    invalid("const presetName = 1;", [
      avoided("presetName", "Preset", "'Overlay Template'"),
    ]),
    invalid("const versionModule = 1;", [
      avoided("versionModule", "Version", "'CourseVersion'"),
      avoided("versionModule", "Module", "'Section'"),
    ]),
    invalid("const x = { unit: 1 };", [avoided("unit", "Unit", "'Section'")]),
    invalid("const { unit } = y;", [avoided("unit", "Unit", "'Section'")]),
    invalid("y.unit = 1;", [avoided("unit", "Unit", "'Section'")]),
    invalid("function f(unit: number) {}", [
      avoided("unit", "Unit", "'Section'"),
    ]),
    invalid("interface P { revision: number }", [
      avoided("revision", "Revision", "'CourseVersion'"),
    ]),
    invalid("import { Module } from 'm';", [
      avoided("Module", "Module", "'Section'"),
    ]),
    invalid("class C { #module = 1; }", [
      avoided("module", "Module", "'Section'"),
    ]),
    invalid("const v = <ModuleCard />;", [
      avoided("ModuleCard", "Module", "'Section'"),
    ]),
    invalid("const v = <Card unit={1} />;", [
      avoided("unit", "Unit", "'Section'"),
    ]),
  ],
});
