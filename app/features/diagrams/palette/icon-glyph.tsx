import { getIconNode } from "@/packages/lucide-icons";

/**
 * Render an icon straight from the VENDORED table, rather than from
 * `lucide-react`.
 *
 * The picker must show exactly the geometry that will be inserted: the frozen
 * table carries names `lucide-react` no longer ships (the 18 brand marks,
 * `fingerprint`) and vice versa, so drawing the picker from the package would
 * put icons on screen that cannot be inserted, and hide ones that can.
 */
export function IconGlyph({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const node = getIconNode(name);
  if (!node) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {node.map(([tag, attrs], i) => {
        // lucide's own vocabulary maps 1:1 onto SVG elements; the attribute
        // names are already SVG's, so they pass straight through.
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as Record<string, string | number>)} />;
      })}
    </svg>
  );
}
