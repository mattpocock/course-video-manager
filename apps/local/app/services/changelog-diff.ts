type DiffLine = { type: "keep" | "add" | "remove"; text: string };

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

export function diffClips(oldClips: string[], newClips: string[]): DiffLine[] {
  const dp = lcsTable(oldClips, newClips);
  const result: DiffLine[] = [];
  let i = oldClips.length;
  let j = newClips.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldClips[i - 1] === newClips[j - 1]) {
      result.push({ type: "keep", text: oldClips[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: "add", text: newClips[j - 1]! });
      j--;
    } else {
      result.push({ type: "remove", text: oldClips[i - 1]! });
      i--;
    }
  }

  return result.reverse();
}

export function formatDiffWithContext(
  diffLines: DiffLine[],
  contextLines: number = 3
): string[] {
  const changedIndices = new Set<number>();
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i]!.type !== "keep") {
      changedIndices.add(i);
    }
  }

  if (changedIndices.size === 0) return [];

  const includedIndices = new Set<number>();
  for (const idx of changedIndices) {
    for (
      let c = Math.max(0, idx - contextLines);
      c <= Math.min(diffLines.length - 1, idx + contextLines);
      c++
    ) {
      includedIndices.add(c);
    }
  }

  const lines: string[] = [];
  let lastIncluded = -2;

  for (let i = 0; i < diffLines.length; i++) {
    if (!includedIndices.has(i)) continue;

    if (lastIncluded >= 0 && i > lastIncluded + 1) {
      lines.push("  ...");
    }
    lastIncluded = i;

    const line = diffLines[i]!;
    switch (line.type) {
      case "add":
        lines.push(`+ ${line.text}`);
        break;
      case "remove":
        lines.push(`- ${line.text}`);
        break;
      case "keep":
        lines.push(`  ${line.text}`);
        break;
    }
  }

  return lines;
}
