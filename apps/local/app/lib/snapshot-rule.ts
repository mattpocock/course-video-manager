export function shouldSnapshot(input: {
  activeDiagramId: string | null;
  diagramFocusedDuringClip: boolean;
}): boolean {
  return input.activeDiagramId !== null && input.diagramFocusedDuringClip;
}
