import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fsWrites from "./fs-writes.js";

RuleTester.describe = describe;
RuleTester.it = it;

const unguarded = [{ messageId: "unguarded" }];

const OPS = [
  "writeFile",
  "writeFileString",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "remove",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "truncate",
];

const GUARDS = [
  "assertUnder",
  "assertUnderEffect",
  "assertUnderFinishedVideos",
  "resolveVideoFilePath",
  "resolveClipMockupPath",
  "locateClipMockupFile",
];

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("fs-writes", fsWrites, {
  valid: [
    `function* save(row) {
      const target = yield* assertUnderEffect(getVideoFilesBaseDir(), row.filePath);
      yield* fs.writeFile(target, bytes);
    }`,
    ...GUARDS.map(
      (guard) =>
        `const target = ${guard}(root, row.filePath);\nfs.rmSync(target);`
    ),
    ...GUARDS.map((guard) => `fs.unlinkSync(${guard}(root, row.filePath));`),
    "function* f() { yield* fs.remove(yield* assertUnderEffect(root, p)); }",
    "function* f() { const t = yield* assertUnderEffect(root, p).pipe(Effect.mapError(wrap));\nyield* fs.remove(t); }",
    "let target = assertUnder(root, p);\nfs.writeFileSync(target, bytes);",
    "const target = assertUnder(root, p);\nfs.copyFileSync(row.filePath, target);",
    "const a = assertUnder(root, p);\nconst b = assertUnder(root, q);\nfs.renameSync(a, b);",
    "fs.readFile(row.filePath);",
    "fs.makeDirectory(row.filePath);",
    "fs.writeFileSyncAll(row.filePath);",
    "cache.writeFile(row.filePath, bytes);",
    "fsp.writeFile(row.filePath, bytes);",
    "removeBestEffort(fs, assertUnder(root, p));",
    "const target = assertUnder(root, p);\nremoveBestEffort(fs, target);",
    "helpers.removeBestEffort(fs, row.filePath);",
    'import { assertUnder as under } from "./assert-under";\nfs.rmSync(under(root, p));',
    'import * as guards from "./assert-under";\nfs.rmSync(guards.assertUnder(root, p));',
    'import { readFileSync } from "node:fs";\nreadFileSync(row.filePath);',
    'import { rmSync } from "./helpers";\nrmSync(row.filePath);',
    "const rmSync = (p) => p;\nrmSync(row.filePath);",
    'import * as io from "./io";\nio.rmSync(row.filePath);',
  ],
  invalid: [
    ...OPS.map((op) => ({
      code: `fs.${op}(row.filePath, bytes);`,
      errors: unguarded,
    })),
    ...[
      "nodeFs",
      "FS",
      "fsvc",
      "fileSystem",
      "FileSystem",
      "this.fs",
      "deps.fileSystem",
    ].map((receiver) => ({
      code: `${receiver}.writeFileSync(row.filePath, bytes);`,
      errors: unguarded,
    })),
    { code: "fs?.rmSync(row.filePath);", errors: unguarded },
    { code: "fs.rmSync();", errors: unguarded },
    { code: "fs.rmSync(path.join(dir, name));", errors: unguarded },
    {
      code: "fs.rmSync(assertUnder(root, p).then(wrap));",
      errors: unguarded,
    },
    { code: 'fs.rmSync(assertUnder(root, p) + ".bak");', errors: unguarded },
    {
      code: "const target = assertUnder(root, p);\nfs.copyFileSync(target, row.filePath);",
      errors: unguarded,
    },
    {
      code: "const a = assertUnder(root, p);\nfs.renameSync(a, row.filePath);",
      errors: unguarded,
    },
    {
      code: "const a = assertUnder(root, p);\nfs.renameSync(row.filePath, a);",
      errors: unguarded,
    },
    { code: "removeBestEffort(fs, row.filePath);", errors: unguarded },
    { code: "removeBestEffort(assertUnder(root, p), raw);", errors: unguarded },
    {
      code: "const target = other(root, p);\nfs.rmSync(target);",
      errors: unguarded,
    },
    {
      code: "fs.rmSync(target);",
      errors: unguarded,
    },
    { code: 'fs["writeFileSync"](row.filePath, bytes);', errors: unguarded },
    { code: "fs[`rmSync`](row.filePath);", errors: unguarded },
    { code: "fs.promises.writeFile(row.filePath, bytes);", errors: unguarded },
    ...[
      'import { rmSync } from "node:fs";\nrmSync(row.filePath);',
      'import { rmSync as nuke } from "fs";\nnuke(row.filePath);',
      'import { rm } from "node:fs/promises";\nrm(row.filePath);',
      'import * as io from "node:fs";\nio.rmSync(row.filePath);',
      'import io from "fs";\nio.unlinkSync(row.filePath);',
      'import { promises } from "fs";\npromises.rm(row.filePath);',
      'import * as io from "fs/promises";\nio.rename(a, b);',
      'import { removeBestEffort as drop } from "./remove-best-effort";\ndrop(fs, row.filePath);',
    ].map((code) => ({ code, errors: unguarded })),
    {
      code: "function a(r, p) { const t = assertUnder(r, p); return t; }\nfunction b(t) { fs.rmSync(t); }",
      errors: unguarded,
    },
    {
      code: "let t = assertUnder(root, p);\nt = row.filePath;\nfs.rmSync(t);",
      errors: unguarded,
    },
  ],
});
