import { useEffect, useRef } from "react";
import { VideoOffIcon } from "lucide-react";
import { RemountCommand } from "@/components/remount-command";
import type { FootageNotFound } from "@/services/clip-source-files.server";
import type { ClipOnDatabase, FrontendId } from "./clip-state-reducer";
import { cn } from "@/lib/utils";
import type { VideoFormat } from "@/features/videos/video-format";
import {
  clipCompositePicture,
  clipLayers,
  clipPlaybackClock,
  clipPlaybackUrl,
  clipSource,
  footageLayers,
} from "@/packages/clip-source";
import { CompositePlayback } from "./components/composite-playback";
import {
  BEAT_DURATION,
  FINAL_VIDEO_PADDING,
  PREVIEW_AUDIO_BOOST_DB,
} from "./constants";
import { useAudioBoost } from "./use-audio-boost";
import type { RunningState } from "./video-state-reducer";
import { OverlayPreview, type ClipOverlay } from "./overlay-preview";
import { clipPlaybackBase, clipPlaybackStyles } from "./clip-playback-picture";
import { FootageLayersPreview } from "./footage-layers-preview";
import { footagePlaybackFrame } from "./footage-playback-frame";
import { useStillsWaitForVideo } from "./components/queued-still";
import { usePreloadableClipReducer } from "./hooks/use-preloadable-clip-reducer";

const PRELOAD_PLAY_AMOUNT = 0.1;

export const PreloadableClip = (props: {
  playbackRate: number;
  clip: ClipOnDatabase;
  onFinish: () => void;
  aggressivePreload: boolean;
  onPreloadComplete: () => void;
  hidden: boolean;
  state: RunningState;
  onUpdateCurrentTime: (time: number) => void;
  profile: string | undefined;
  /** The Video's format: a CVM-recorder Clip's Scene Layer is drawn in it. */
  videoFormat: VideoFormat;
  scrubSeekTime: number | undefined;
  /**
   * Every Overlay this Clip must draw — already selected upstream. Not the
   * same as the Overlays anchored to it: a card anchored to an earlier Clip
   * that is still running is in here too, with a negative `at`.
   */
  overlays: ClipOverlay[];
  /**
   * "Footage not found (E: offline?): …" when this Clip's Footage is on no
   * reachable Storage Root: shown in place of the player.
   */
  footageNotFound: FootageNotFound | undefined;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  // The overlay preview's own clip-relative playhead (`overlayTime`) mirrors
  // what `onUpdateCurrentTime` below sends up to the editor's
  // `currentTimeInClip`, but is kept per Clip too: `OverlayPreview` needs it
  // on every frame this Clip is the one playing, and re-deriving it from
  // context would mean threading context into an otherwise prop-only
  // component.
  const {
    state: { preload: preloadState, overlayTime: overlayCurrentTime },
    dispatch,
    reportPlayhead,
  } = usePreloadableClipReducer(ref, props.onPreloadComplete);
  useAudioBoost(ref, PREVIEW_AUDIO_BOOST_DB);

  // The `<video>` below is the playback clock: an OBS Clip's Footage, or a
  // CVM-recorder Clip's mic, which runs `clockOffset` behind the picture.
  // Every time this component keeps is the clock's own.
  const source = clipSource(props.clip, { videoFormat: props.videoFormat });
  const clockOffset = clipPlaybackClock(source).offsetSeconds;
  const layersOver = footageLayers(clipLayers(source));
  // The clip-relative playhead is kept only for a Clip that draws something
  // on it: an Overlay, or a Footage Layer.
  const tracksPlayhead = props.overlays.length > 0 || layersOver.length > 0;
  const clockStart = props.clip.sourceStartTime - clockOffset;
  const preloadFrom = clockStart - PRELOAD_PLAY_AMOUNT;
  const preloadTo = clockStart;
  const modifiedEndTime = props.clip.sourceEndTime - 0.06 - clockOffset;
  const picture = clipCompositePicture(source, {
    from: preloadFrom + clockOffset,
    to: modifiedEndTime + clockOffset,
  });

  const playbackUrl = clipPlaybackUrl(source, {
    from: preloadFrom + clockOffset,
    to: modifiedEndTime + clockOffset,
  });
  useStillsWaitForVideo(ref, playbackUrl);

  const isPlaying = !props.hidden && props.state === "playing";

  // Keeps the overlay playhead in step with the `<video>` while it is NOT
  // playing. The rAF loop below stops on pause and never runs before the first
  // play, so on its own it leaves `overlayCurrentTime` at 0 — a paused or
  // scrubbed Clip would show no Definition Card at all, however far into an
  // Overlay the playhead sits.
  useEffect(() => {
    const video = ref.current;
    if (!video || props.hidden || !tracksPlayhead) {
      return;
    }

    const sync = () => reportPlayhead(video.currentTime - clockStart);

    sync();
    video.addEventListener("seeked", sync);
    video.addEventListener("timeupdate", sync);
    return () => {
      video.removeEventListener("seeked", sync);
      video.removeEventListener("timeupdate", sync);
    };
  }, [ref.current, props.hidden, tracksPlayhead, clockStart, reportPlayhead]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    ref.current.playbackRate = props.playbackRate;
  }, [props.playbackRate, ref.current]);

  useEffect(() => {
    if (!ref.current || props.hidden || props.scrubSeekTime === undefined) {
      return;
    }
    ref.current.pause();
    ref.current.currentTime = props.scrubSeekTime - clockOffset;
  }, [props.scrubSeekTime, props.hidden, ref.current]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    if (preloadState === "preloading" && props.aggressivePreload) {
      ref.current.muted = true;
      ref.current.play();
      return;
    }

    if (props.hidden || !props.aggressivePreload) {
      ref.current.pause();
      ref.current.currentTime = clockStart;
      ref.current.muted = false;
      return;
    }

    if (isPlaying) {
      ref.current.play();
    } else {
      ref.current.pause();
    }
  }, [
    props.hidden,
    ref.current,
    props.state,
    preloadState,
    props.aggressivePreload,
  ]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    if (!isPlaying && preloadState === "finished") {
      return;
    }
    let animationId: number | null = null;

    const checkCurrentTime = () => {
      const currentTime = ref.current!.currentTime;

      if (preloadState === "preloading") {
        if (currentTime >= preloadTo) {
          dispatch({ type: "clip-preloaded", at: preloadTo });
        }
      } else if (currentTime >= modifiedEndTime) {
        ref.current!.pause();
        props.onFinish();
        ref.current!.currentTime = clockStart;
        return;
      }

      const clipRelativeTime = currentTime - clockStart;
      props.onUpdateCurrentTime(clipRelativeTime);
      if (tracksPlayhead) {
        reportPlayhead(clipRelativeTime);
      }

      animationId = requestAnimationFrame(checkCurrentTime);
    };

    animationId = requestAnimationFrame(checkCurrentTime);

    return () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [
    ref.current,
    isPlaying,
    preloadState,
    modifiedEndTime,
    clockStart,
    preloadTo,
    props.onUpdateCurrentTime,
    tracksPlayhead,
    dispatch,
    reportPlayhead,
  ]);

  // The Overlay's Transform slides the whole picture (every Layer, the black
  // base too), as the export's composite pass does; the Clip Zoom zooms the
  // Scene Layer alone. No Transform is read for a hidden Clip.
  const styles = clipPlaybackStyles({
    overlays: props.hidden ? EMPTY_OVERLAYS : props.overlays,
    currentTime: overlayCurrentTime,
    zoomType: props.clip.zoomType,
  });
  const base = clipPlaybackBase(source);
  const frameClass =
    props.profile === "TikTok"
      ? "w-92 aspect-[9/16]"
      : props.videoFormat === "short"
        ? "aspect-[9/16]"
        : "aspect-[16/9]";

  // `overflow-hidden` and the ground colour are the frame the Overlay
  // Transform slides INSIDE: the move is a translate, so without a clip the
  // picture would spill over whatever sits beside it, and the space it
  // vacates would show the page rather than the panel's own ground.
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-[#101011]",
        props.hidden && "hidden"
      )}
    >
      {props.footageNotFound !== undefined && (
        <div
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 bg-[#101011] p-6 text-center",
            props.profile === "TikTok" ? "w-92 aspect-[9/16]" : "aspect-[16/9]"
          )}
          data-testid="footage-not-found"
        >
          <VideoOffIcon className="size-10 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            {props.footageNotFound.headline}
          </p>
          <p className="text-xs text-muted-foreground break-all">
            {props.footageNotFound.path}
          </p>
          {props.footageNotFound.remountCommands.map((command) => (
            <div key={command} className="w-full max-w-xl pt-2">
              <RemountCommand command={command} />
            </div>
          ))}
        </div>
      )}
      {/* The Clip's picture: every Layer, bottom to top, slid together by
          the Transform. */}
      <div className="relative w-full" style={styles.picture}>
        <video
          key={props.clip.frontendId}
          src={playbackUrl}
          className={cn(
            "w-full",
            props.profile === "TikTok" && "w-92 aspect-[9/16]",
            footagePlaybackFrame(props.videoFormat) === "cover-portrait" &&
              "aspect-[9/16] object-cover",
            // The clock is heard, not seen, when something else draws the
            // picture: a CVM-recorder Clip's composite, or the black base of
            // a Clip with no Scene Layer.
            (picture || base === "black") && "hidden",
            props.footageNotFound !== undefined && "hidden"
          )}
          // The Clip Zoom, formatted from the same numbers as the export's
          // ffmpeg filter (features/videos/clip-zoom), so what plays here is
          // what ships.
          style={styles.scene}
          ref={ref}
        />
        {picture && props.footageNotFound === undefined && (
          <CompositePlayback
            clock={ref}
            picture={picture}
            offsetSeconds={clockOffset}
            hidden={props.hidden}
            editorPlaying={isPlaying}
            style={styles.scene}
          />
        )}
        {/* No Scene Layer: the Footage Layers are drawn on black, as the
            export's layered segment draws them. */}
        {base === "black" && props.footageNotFound === undefined && (
          <div
            className={cn("w-full bg-black", frameClass)}
            data-testid="clip-black-base"
          />
        )}
        {/* Over the Clip's picture, under any card. Mounted for a preloading
            Clip too, so its Footage Layers are ready when the Clip comes up. */}
        {props.footageNotFound === undefined &&
          (!props.hidden || props.aggressivePreload) && (
            <FootageLayersPreview
              layers={layersOver}
              currentTime={overlayCurrentTime}
              playing={isPlaying}
              playbackRate={props.playbackRate}
              videoFormat={props.videoFormat}
            />
          )}
      </div>
      {/* Only mounted for the Clip actually on screen — every other Clip in
          the manager is preloading off-screen (`hidden`), and there is no
          reason to run an extra `<Player>` per one of those. */}
      {!props.hidden && props.overlays.length > 0 && (
        <OverlayPreview
          overlays={props.overlays}
          currentTime={overlayCurrentTime}
        />
      )}
    </div>
  );
};

export const PreloadableClipManager = (props: {
  playbackRate: number;
  clips: ClipOnDatabase[];
  finalClipId: string | undefined;
  clipsToAggressivelyPreload: string[];
  state: RunningState;
  currentClipId: FrontendId | undefined;
  currentClipProfile: string | undefined;
  videoFormat: VideoFormat;
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
  scrubSeekTime: number | undefined;
  /**
   * Every Overlay each Clip must draw, keyed by Clip database id. Grouped for
   * the whole Video upstream rather than here, because an Overlay may outlive
   * its anchor Clip and keep showing over the Clips that follow — a walk that
   * needs every Clip's length, not only the preloaded Clips in `clips` above.
   */
  overlaysByClipId: Map<string, ClipOverlay[]>;
  /** Clips whose Footage is on no reachable Storage Root, by database id. */
  footageNotFound: Record<string, FootageNotFound>;
}) => {
  return (
    <div className="">
      {props.clips.map((clip) => {
        const isCurrentlyPlaying = clip.frontendId === props.currentClipId;

        const onFinish = () => {
          if (!isCurrentlyPlaying) {
            return;
          }

          if (clip.pauseType === "long") {
            setTimeout(() => {
              props.onClipFinished();
            }, BEAT_DURATION * 1000);
          } else {
            props.onClipFinished();
          }
        };

        const isFinalClip = clip.frontendId === props.finalClipId;

        const modifiedClip = isFinalClip
          ? { ...clip, sourceEndTime: clip.sourceEndTime + FINAL_VIDEO_PADDING }
          : clip;

        return (
          <div key={clip.frontendId}>
            <PreloadableClip
              playbackRate={props.playbackRate}
              clip={modifiedClip}
              key={clip.frontendId}
              onFinish={onFinish}
              aggressivePreload={props.clipsToAggressivelyPreload.includes(
                clip.frontendId
              )}
              hidden={!isCurrentlyPlaying}
              state={props.state}
              profile={props.currentClipProfile}
              videoFormat={props.videoFormat}
              onUpdateCurrentTime={(time) => {
                if (isCurrentlyPlaying) {
                  props.onUpdateCurrentTime(time);
                }
              }}
              onPreloadComplete={() => {}}
              footageNotFound={props.footageNotFound[clip.databaseId]}
              scrubSeekTime={
                isCurrentlyPlaying ? props.scrubSeekTime : undefined
              }
              overlays={
                props.overlaysByClipId.get(clip.databaseId) ?? EMPTY_OVERLAYS
              }
            />
          </div>
        );
      })}
    </div>
  );
};

/** A stable empty array, so a Clip with no Overlays gets the same reference
 * on every render instead of a fresh `[]` retriggering its effects. */
const EMPTY_OVERLAYS: ClipOverlay[] = [];
