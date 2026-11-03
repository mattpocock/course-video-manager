import { useMemo } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { cn } from "@/lib/utils";
import { VideoEditorContext } from "../video-editor-context";
import type { ClipOnDatabase } from "../clip-state-reducer";
import { clipLayerFlags, clipLayersShown, clipsFlagged } from "../clip-layers";

const Field = (props: { label: string; value: string }) => (
  <div className="flex gap-2 min-w-0">
    <dt className="text-muted-foreground w-20 shrink-0">{props.label}</dt>
    <dd className="truncate" title={props.value}>
      {props.value}
    </dd>
  </div>
);

/**
 * The editor's read-only list of the current Clip's Layers, bottom to top,
 * beside the player on both Video Formats, with what looks wrong with them
 * (a Placement checked against the Video's own frame), and the other Clips of
 * the Video that have a flag. Layers are edited with `cvm clip layer`.
 */
export const ClipLayersList = () => {
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const currentClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClip
  );

  const saved = useMemo(
    () =>
      clips.filter(
        (clip): clip is ClipOnDatabase => clip.type === "on-database"
      ),
    [clips]
  );
  const videoFormat = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoFormat
  );
  const flagged = useMemo(
    () => clipsFlagged(saved, videoFormat),
    [saved, videoFormat]
  );
  const clip = currentClip?.type === "on-database" ? currentClip : undefined;
  const layers = useMemo(() => (clip ? clipLayersShown(clip) : []), [clip]);
  const flags = useMemo(
    () => (clip ? clipLayerFlags(clip, videoFormat) : []),
    [clip, videoFormat]
  );

  return (
    <aside
      aria-label="Layers"
      className="w-64 shrink-0 h-full overflow-y-auto text-xs flex flex-col gap-3 py-1"
    >
      <section>
        <h3 className="font-medium text-sm mb-1">Layers</h3>
        {!clip ? (
          <p className="text-muted-foreground">No Clip selected.</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-2">
              Bottom to top. Edit with <code>cvm clip layer</code>.
            </p>
            {flags
              .filter((flag) => flag.layer === null)
              .map((flag) => (
                <p
                  key={flag.message}
                  className="flex gap-1 text-amber-600 dark:text-amber-400 mb-2"
                >
                  <AlertTriangleIcon className="size-3.5 shrink-0 mt-px" />
                  {flag.message}
                </p>
              ))}
            <ol className="flex flex-col gap-2">
              {layers.map((layer) => {
                const layerFlags = flags.filter(
                  (flag) => flag.layer === layer.index
                );
                return (
                  <li
                    key={layer.index}
                    className={cn(
                      "rounded-md bg-card p-2",
                      layerFlags.length > 0 && "ring-1 ring-amber-500"
                    )}
                  >
                    <div className="font-medium mb-1">
                      {layer.index}. {layer.kind} Layer
                    </div>
                    <dl className="flex flex-col gap-0.5">
                      <Field label="Footage" value={layer.footage} />
                      <Field label="Source Crop" value={layer.sourceCrop} />
                      <Field label="Placement" value={layer.placement} />
                      <Field label="Volume" value={layer.volume} />
                      <Field label="Span" value={layer.span} />
                    </dl>
                    {layerFlags.map((flag) => (
                      <p
                        key={flag.message}
                        className="flex gap-1 text-amber-600 dark:text-amber-400 mt-1"
                      >
                        <AlertTriangleIcon className="size-3.5 shrink-0 mt-px" />
                        {flag.message}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {flagged.length > 0 && (
        <section>
          <h3 className="font-medium text-sm mb-1">Clips to check</h3>
          <ul className="flex flex-col gap-1">
            {flagged.map(({ clip: flaggedClip, number, flags }) => (
              <li
                key={flaggedClip.frontendId}
                className={cn(
                  "rounded px-1.5 py-1",
                  flaggedClip.frontendId === clip?.frontendId && "bg-muted"
                )}
              >
                <span className="font-medium">Clip {number}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {flags[0]!.message}
                  {flags.length > 1 && ` (+${flags.length - 1} more)`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
};
