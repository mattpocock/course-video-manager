import { readFileSync } from "node:fs";

interface Avoided {
  words: readonly string[];
  text: string;
  use: string[];
}

export interface Hit {
  avoided: string;
  use: readonly string[];
}

export interface Glossary {
  hitsIn: (identifier: string) => readonly Hit[];
}

const HEADING =
  /^\*\*[^*]+\*\*(?:\s*\/\s*\*\*[^*]+\*\*)*(?:\s*\([^)]*\))?:\s*$/;
const AVOID = /^_Avoid_:(.*)$/;
const PARENTHETICAL = /\s*\([^)]*\)/g;

/**
 * Splits a name or a glossary phrase into lowercase words, on camelCase,
 * PascalCase, acronyms, digits and any other character (`_`, `$`, `-`, space).
 */
export const wordsOf = (name: string): string[] =>
  (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map((word) =>
    word.toLowerCase()
  );

const startsAt = (
  words: readonly string[],
  at: number,
  phrase: readonly string[]
) => phrase.every((word, offset) => words[at + offset] === word);

const parse = (source: string, file: string) => {
  const names: string[][] = [];
  const byKey = new Map<string, Avoided>();
  let heading: string | undefined;
  for (const raw of source.split("\n")) {
    const text = raw.trim();
    if (HEADING.test(text)) {
      const bold = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map(
        (m) => m[1] ?? ""
      );
      heading = bold.join(" / ");
      names.push(...bold.map(wordsOf));
      continue;
    }
    const avoid = AVOID.exec(text);
    if (!avoid) continue;
    if (heading === undefined) {
      throw new Error(`${file}: an _Avoid_ list sits under no **term**`);
    }
    const entries = (avoid[1] ?? "").replace(PARENTHETICAL, "").split(",");
    for (const entry of entries) {
      const phrase = entry.trim();
      const words = wordsOf(phrase);
      if (words.length === 0) continue;
      const key = words.join(" ");
      const known = byKey.get(key) ?? { words, text: phrase, use: [] };
      if (!known.use.includes(heading)) known.use.push(heading);
      byKey.set(key, known);
    }
  }
  if (byKey.size === 0) {
    throw new Error(`${file} has no _Avoid_ lines, so nothing can be checked`);
  }
  return { names, avoided: [...byKey.values()] };
};

/** The `glossary` path out of the rule's options, which Oxlint has checked. */
export const glossaryOption = (options: readonly unknown[]): string => {
  const [option] = options;
  if (
    typeof option === "object" &&
    option !== null &&
    "glossary" in option &&
    typeof option.glossary === "string"
  ) {
    return option.glossary;
  }
  throw new Error("local/glossary-terms needs { glossary: <path> }");
};

/**
 * Reads a GLOSSARY.md: each `_Avoid_` entry, with its parenthetical notes
 * stripped, is paired with the bold term it sits under. `hitsIn` returns the
 * avoided entries an identifier's words contain as consecutive words, in
 * order, skipping an entry that lies inside a glossary term's own name there
 * (`preservedSnapshot`) or inside a longer hit (`deleteVersion`).
 */
export const readGlossary = (file: string): Glossary => {
  const { names, avoided } = parse(readFileSync(file, "utf8"), file);
  const cache = new Map<string, readonly Hit[]>();

  const find = (identifier: string): readonly Hit[] => {
    const words = wordsOf(identifier);
    const spans: [number, number][] = [];
    words.forEach((_, at) => {
      for (const name of names) {
        if (startsAt(words, at, name)) spans.push([at, at + name.length]);
      }
    });
    const within = (from: number, to: number) =>
      spans.some(([start, end]) => start <= from && to <= end);
    const hits: Hit[] = [];
    words.forEach((_, at) => {
      const matched = avoided
        .filter((entry) => startsAt(words, at, entry.words))
        .sort((a, b) => b.words.length - a.words.length);
      for (const entry of matched) {
        const to = at + entry.words.length;
        if (within(at, to)) continue;
        hits.push({ avoided: entry.text, use: entry.use });
        spans.push([at, to]);
      }
    });
    return hits;
  };

  return {
    hitsIn(identifier) {
      const known = cache.get(identifier);
      if (known) return known;
      const hits = find(identifier);
      cache.set(identifier, hits);
      return hits;
    },
  };
};
