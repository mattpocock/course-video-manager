import { Film } from "lucide-react";
import { useMemo } from "react";
import {
  animaticExportBlocker,
  type AnimaticExportCandidate,
} from "./animatic-export";

/**
 * The Animatic page's Export button, on the stage beside the subtitles
 * control: it starts the `export-animatic` Job, which writes the Animatic to
 * `finished-videos/` as `{courseId}-{hash}.animatic.mp4`. Disabled, with
 * the reason as its tooltip, while a voice is still coming or a frame is
 * missing — the Job refuses with the same words, so the two always agree.
 */
export const AnimaticExportButton = (props: {
  mockups: readonly AnimaticExportCandidate[];
  onExport: () => void;
}) => {
  const blocker = useMemo(
    () => animaticExportBlocker(props.mockups),
    [props.mockups]
  );
  return (
    <button
      type="button"
      className="allow-keydown flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-sm hover:bg-black/90 disabled:cursor-not-allowed disabled:text-white/40 disabled:hover:bg-black/70"
      onClick={props.onExport}
      disabled={blocker !== null}
      title={
        blocker === null
          ? "Export this Animatic to finished-videos as an .animatic.mp4"
          : `Cannot export yet: ${blocker}`
      }
    >
      <Film className="size-4" />
      Export
    </button>
  );
};
