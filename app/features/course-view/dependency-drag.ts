export type DropResult =
  | { action: "add"; dependencies: string[] }
  | { action: "remove"; dependencies: string[] }
  | { action: "noop"; reason: "self" | "cycle" };

export function computeDropResult(
  sourceId: string,
  targetId: string,
  currentDependencies: string[],
  dependencyMap: Record<string, string[]>
): DropResult {
  if (sourceId === targetId) {
    return { action: "noop", reason: "self" };
  }

  if (currentDependencies.includes(targetId)) {
    return {
      action: "remove",
      dependencies: currentDependencies.filter((d) => d !== targetId),
    };
  }

  if (wouldCreateCycle(sourceId, targetId, dependencyMap)) {
    return { action: "noop", reason: "cycle" };
  }

  return {
    action: "add",
    dependencies: [...currentDependencies, targetId],
  };
}

export function wouldCreateCycle(
  fromId: string,
  toId: string,
  depMap: Record<string, string[]>
): boolean {
  const visited = new Set<string>();
  const stack = [toId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of depMap[current] ?? []) {
      stack.push(dep);
    }
  }
  return false;
}
