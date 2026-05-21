export interface GridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function getRuleOfThirdsLines(
  width: number,
  height: number
): GridLine[] {
  return [
    { x1: width / 3, y1: 0, x2: width / 3, y2: height },
    { x1: (width * 2) / 3, y1: 0, x2: (width * 2) / 3, y2: height },
    { x1: 0, y1: height / 3, x2: width, y2: height / 3 },
    { x1: 0, y1: (height * 2) / 3, x2: width, y2: (height * 2) / 3 },
  ];
}
