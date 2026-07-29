/**
 * PROTOTYPE — throwaway. Bakes lucide's raw geometry out of node_modules.
 *
 * Reads the `__iconNode` named export from every
 * `lucide-react/dist/esm/icons/*.js` and writes a flat
 * `Record<kebabName, IconNode>` (keys stripped) to src/icon-nodes.json.
 *
 * This is the build-time codegen step the real feature would use.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const iconsDir = path.join(
  path.dirname(require.resolve("lucide-react/package.json")),
  "dist/esm/icons",
);

const out = {};
let failures = 0;

for (const file of readdirSync(iconsDir)) {
  if (!file.endsWith(".js") || file.endsWith(".d.ts")) continue;
  const name = file.replace(/\.js$/, "");
  const src = readFileSync(path.join(iconsDir, file), "utf8");
  const match = src.match(/const __iconNode = (\[[\s\S]*?\]);\r?\n/);
  if (!match) {
    failures++;
    continue;
  }
  const node = new Function(`return ${match[1]}`)();
  out[name] = node.map(([tag, attrs]) => {
    const { key, ...rest } = attrs;
    return [tag, rest];
  });
}

const target = new URL("./src/icon-nodes.json", import.meta.url);
writeFileSync(target, JSON.stringify(out));
console.log(
  `wrote ${Object.keys(out).length} icons (${failures} unparsed) -> ${target.pathname}`,
);
