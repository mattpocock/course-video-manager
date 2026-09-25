import { Link } from "react-router";
import { FilmIcon } from "lucide-react";

/**
 * What the Animatic shows for a Video with no Clip Mockups.
 *
 * The Animatic is reachable from the Video's header whether or not there is
 * anything to watch, so this state is a normal state and not an error: the
 * author who clicks through to it has to learn HOW Clip Mockups come to exist,
 * which is one `cvm` command an agent runs for him.
 */
export const AnimaticEmptyState = (props: { videoId: string }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
    <FilmIcon className="size-8 text-muted-foreground/60" />
    <h2 className="text-base font-semibold">No Clip Mockups yet</h2>
    <p className="max-w-lg text-sm text-muted-foreground">
      There is no Animatic to watch until this Video has Clip Mockups — one
      still frame and one spoken line per moment. Author them with{" "}
      <code className="font-mono text-foreground">cvm clip-mockup add</code> and
      this page plays them in order.
    </p>
    <Link
      to={`/videos/${props.videoId}/edit`}
      className="rounded-md border px-4 py-2 text-sm hover:bg-muted/60"
    >
      Back to the Video
    </Link>
  </div>
);
