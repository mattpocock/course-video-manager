import { getRuleOfThirdsLines } from "./rule-of-thirds";

export function RuleOfThirdsGrid({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const lines = getRuleOfThirdsLines(width, height);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {lines.map((line, i) => (
        <line
          key={i}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="white"
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeDasharray="8 6"
        />
      ))}
    </svg>
  );
}
