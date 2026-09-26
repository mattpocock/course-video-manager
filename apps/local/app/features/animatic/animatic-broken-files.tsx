import type { AnimaticClipMockup } from "./animatic-timeline";

/** The Clip Mockups whose frame or speech is not on disk, listed above the rows. */
export const AnimaticBrokenFiles = (props: {
  mockups: readonly AnimaticClipMockup[];
}) => {
  const broken = props.mockups.filter((m) => m.imageMissing || m.audioMissing);
  if (broken.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
      <div className="font-semibold">
        {broken.length} Clip Mockup{broken.length === 1 ? "" : "s"} cannot play
        in full
      </div>
      <ul className="mt-1 space-y-0.5">
        {broken.map((m) => (
          <li key={m.id}>
            #{m.position}:{" "}
            {[
              m.imageMissing ? "frame file missing" : null,
              m.audioMissing ? "speech file missing" : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
};
