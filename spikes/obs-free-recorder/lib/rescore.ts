// `./rig verdict <runDir>`: one run folder's stop criteria and PASS/FAIL, for
// the wizard. `./rig rescore <runDir>`: the current analysis re-run on an old
// run, writing only to a scratch folder.
import fs from "node:fs";
import path from "node:path";
import { analyze, type Meta } from "./analyze.ts";
import { forTerminal } from "./wrap.ts";

const CRASH_ROW = "kill -9 recovery (<= 2 s lost)";

/**
 * A run folder's verdict from its report.md, or, for a kill -9 run that only
 * wrote meta.json (the selftest's crash phase never analyses), from
 * meta.crash. `table`: a "## Stop criteria" Markdown table either way. A
 * folder with neither fails: there's nothing to say it worked.
 */
export function runVerdict(
  reportMd: string | null,
  metaJson: string | null
): { pass: boolean; table: string } {
  const head = "## Stop criteria\n\n| Criterion | Result |\n|---|---|\n";
  if (reportMd !== null) {
    const rows = (
      /^## Stop criteria\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(reportMd)?.[1] ??
      ""
    )
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Criterion |"));
    const pass = rows.length > 0 && !rows.some((l) => /\| FAIL/.test(l));
    return {
      pass,
      table:
        head +
        (rows.length
          ? rows.join("\n")
          : "| report.md | FAIL (no stop criteria in it) |"),
    };
  }
  const meta = metaJson === null ? null : (JSON.parse(metaJson) as Meta);
  if (meta?.crash) {
    const lost = (meta.crash.files ?? [])
      .map(
        (f) =>
          `${f.file} ${f.ok ? "ok" : "BAD"}, ${f.lostSeconds ?? "?"} s lost`
      )
      .join("; ");
    const v = meta.crash.pass ? "PASS" : "FAIL";
    return {
      pass: meta.crash.pass,
      table: `${head}| ${CRASH_ROW} | ${v}${lost ? ` (${lost})` : ""} |`,
    };
  }
  return {
    pass: false,
    table: `${head}| report | FAIL (no report.md, and no kill -9 result in meta.json) |`,
  };
}

export function verdictOf(runDir: string) {
  const read = (f: string) => {
    const p = path.join(runDir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };
  return runVerdict(read("report.md"), read("meta.json"));
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Re-scores old runs with today's analysis. Nothing is written next to the
 * runs: the baseline (if given) is re-scored into <scratch>/<its name>, and
 * the run into <scratch>/<its name>, compared against that re-scored baseline.
 * `obsScenes`: OBS's scene collection, for a baseline that didn't save one.
 */
export function rescore(
  o: {
    runDir: string;
    baselineDir?: string;
    scratch: string;
    obsScenes?: string;
    /** The rig's own output root (--out): the scratch folder may not be in it. */
    outRoot: string;
  },
  log: (...a: unknown[]) => void
): string[] {
  const scratch = path.resolve(o.scratch);
  for (const d of [o.runDir, o.baselineDir, o.outRoot].filter(
    (x): x is string => !!x
  ))
    if (inside(scratch, d))
      throw new Error(
        `--scratch ${scratch} is inside ${d}: rescore never writes next to a run`
      );
  const written: string[] = [];
  let baselineOut: string | undefined;
  if (o.baselineDir) {
    baselineOut = path.join(scratch, path.basename(o.baselineDir));
    log(`re-scoring the baseline ${o.baselineDir} → ${baselineOut}`);
    analyze(o.baselineDir, undefined, { outDir: baselineOut });
    written.push(baselineOut);
  }
  if (path.resolve(o.runDir) !== path.resolve(o.baselineDir ?? "")) {
    const out = path.join(scratch, path.basename(o.runDir));
    log(`re-scoring ${o.runDir} → ${out}`);
    analyze(o.runDir, o.baselineDir, {
      outDir: out,
      baselineReportDir: baselineOut,
      obsScenes: o.obsScenes,
    });
    written.push(out);
  }
  return written;
}

/** ./rig verdict <runDir>: prints the stop criteria table, exits 0 on PASS. */
export function verdictCommand(dir: string | undefined) {
  if (!dir) throw new Error("usage: ./rig verdict <runDir>");
  const v = verdictOf(path.resolve(dir));
  console.log(v.table);
  process.exit(v.pass ? 0 : 1);
}

/** ./rig rescore <runDir> --scratch <dir> [--baseline <dir>] [--obs-scenes <file>] */
export function rescoreCommand(
  dir: string | undefined,
  flags: {
    scratch?: string;
    baseline?: string;
    "obs-scenes"?: string;
    out?: string;
  },
  log: (...a: unknown[]) => void
) {
  if (!dir || !flags.scratch)
    throw new Error(
      "usage: ./rig rescore <runDir> --scratch <dir> [--baseline <dir>] [--obs-scenes <OBS scene collection .json>]"
    );
  const written = rescore(
    {
      runDir: path.resolve(dir),
      baselineDir: flags.baseline && path.resolve(flags.baseline),
      scratch: flags.scratch,
      obsScenes: flags["obs-scenes"],
      outRoot: flags.out ?? "/mnt/d/obs-rig",
    },
    log
  );
  for (const d of written)
    console.log(
      forTerminal(
        fs
          .readFileSync(path.join(d, "report.md"), "utf8")
          .split("## Sync at")[0]!,
        process.stdout.columns || undefined
      )
    );
}
