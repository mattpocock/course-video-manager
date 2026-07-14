import type { DB } from "@/db/schema";
import type {
  ClipReducerAction,
  ClipReducerEffect,
  ClipReducerState,
  DatabaseId,
} from "@/features/video-editor/clip-state-reducer";
import {
  INSERTION_POINT_ID,
  RECORDING_SESSION_PANELS_ID,
} from "@/features/video-editor/constants";
import type { ClipService } from "@/services/clip-service";
import type { EffectsMap } from "use-effect-reducer";
import type React from "react";
import { sendToChild, subscribeParent } from "@/lib/diagram-protocol";

export interface EditEffectHandlersDeps {
  videoId: string;
  clipService: ClipService;
  clipStateRef: React.RefObject<ClipReducerState>;
  revalidate: () => void;
  whiteNoiseAssetPath: string;
}

export function createEditEffectHandlers(
  deps: EditEffectHandlersDeps
): EffectsMap<ClipReducerState, ClipReducerAction, ClipReducerEffect> {
  const {
    videoId,
    clipService,
    clipStateRef,
    revalidate,
    whiteNoiseAssetPath,
  } = deps;

  return {
    "archive-clips": (_state, effect, dispatch) => {
      clipService.archiveClips(effect.clipIds).catch((error) => {
        dispatch({
          type: "effect-failed",
          effectType: "archive-clips",
          message:
            error instanceof Error ? error.message : "Failed to archive clips",
        });
      });
    },
    "unarchive-clips": (_state, effect, dispatch) => {
      clipService.unarchiveClips(effect.clipIds).catch((error) => {
        dispatch({
          type: "effect-failed",
          effectType: "unarchive-clips",
          message:
            error instanceof Error
              ? error.message
              : "Failed to unarchive clips",
        });
      });
    },
    "transcribe-clips": (_state, effect, dispatch) => {
      fetch("/clips/transcribe", {
        method: "POST",
        body: JSON.stringify({ clipIds: effect.clipIds }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then((clips: DB.Clip[]) => {
          dispatch({
            type: "clips-transcribed",
            clips: clips.map((clip) => ({
              databaseId: clip.id,
              text: clip.text,
            })),
          });
        })
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "transcribe-clips",
            message:
              error instanceof Error
                ? error.message
                : "Failed to transcribe clips",
          });
        });
    },
    "scroll-to-insertion-point": () => {
      const recordingPanel = document.querySelector("[data-session-recording]");
      if (recordingPanel) {
        recordingPanel.scrollIntoView({ behavior: "smooth", block: "end" });
        return;
      }
      const sessionPanels = document.getElementById(
        RECORDING_SESSION_PANELS_ID
      );
      if (sessionPanels) {
        sessionPanels.scrollIntoView({ behavior: "smooth", block: "end" });
        return;
      }
      const insertionPoint = document.getElementById(INSERTION_POINT_ID);
      if (insertionPoint) {
        insertionPoint.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    "update-clips": (_state, effect, dispatch) => {
      // Transform tuple format [id, { scene, profile, pauseType }] to UpdateClipInput
      const clipsInput = effect.clips.map(([id, data]) => ({
        id,
        scene: data.scene,
        profile: data.profile,
        pauseType: data.pauseType,
      }));
      clipService.updateClips(clipsInput).catch((error) => {
        dispatch({
          type: "effect-failed",
          effectType: "update-clips",
          message:
            error instanceof Error ? error.message : "Failed to update clips",
        });
      });
    },
    "update-pause": (_state, effect, dispatch) => {
      clipService
        .updatePause(effect.clipId, effect.pauseType)
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "update-pause",
            message:
              error instanceof Error ? error.message : "Failed to update pause",
          });
        });
    },
    "reorder-clip": (_state, effect, dispatch) => {
      clipService
        .reorderClip(effect.clipId, effect.direction)
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "reorder-clip",
            message:
              error instanceof Error ? error.message : "Failed to reorder clip",
          });
        });
    },
    "reorder-chapter": (_state, effect, dispatch) => {
      clipService
        .reorderChapter(effect.chapterId, effect.direction)
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "reorder-chapter",
            message:
              error instanceof Error
                ? error.message
                : "Failed to reorder chapter",
          });
        });
    },
    "archive-chapters": (_state, effect, dispatch) => {
      clipService.archiveChapters(effect.chapterIds).catch((error) => {
        dispatch({
          type: "effect-failed",
          effectType: "archive-chapters",
          message:
            error instanceof Error
              ? error.message
              : "Failed to archive chapters",
        });
      });
    },
    "create-chapter": (state, effect, dispatch) => {
      clipService
        .createChapterAtInsertionPoint({
          videoId,
          name: effect.name,
          insertionPoint: effect.insertionPoint,
          items: state.items,
        })
        .then((chapter) => {
          dispatch({
            type: "chapter-created",
            frontendId: effect.frontendId,
            databaseId: chapter.id as DatabaseId,
          });
        })
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "create-chapter",
            message:
              error instanceof Error
                ? error.message
                : "Failed to create chapter",
          });
        });
    },
    "update-chapter": (_state, effect, dispatch) => {
      clipService
        .updateChapter(effect.chapterId, effect.name)
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "update-chapter",
            message:
              error instanceof Error
                ? error.message
                : "Failed to update chapter",
          });
        });
    },
    "start-session-timeout": (_state, effect, dispatch) => {
      const timeout = setTimeout(() => {
        dispatch({
          type: "session-polling-complete",
          sessionId: effect.sessionId,
        });
      }, 10_000);

      return () => {
        clearTimeout(timeout);
      };
    },
    "start-session-polling": (_state, effect, dispatch) => {
      let unmounted = false;

      // The Diagram Playground actually creates auto-pin snapshots — it has
      // the tldraw editor and can render a thumbnail. We just tell it which
      // clip to pin and, on the ack, push the new pin into reducer state so
      // the clip's pin indicator updates without waiting for a reload.
      const unsubAck = subscribeParent((msg) => {
        if (msg.type !== "snapshotForClipDone" || !msg.ok) return;
        const item = clipStateRef.current.items.find(
          (i) => i.type === "on-database" && i.databaseId === msg.clipId
        );
        if (item && item.type === "on-database") {
          dispatch({
            type: "update-clip-diagram-pin",
            clipId: item.frontendId,
            diagramSnapshotId: msg.snapshotId,
            diagramName: msg.diagramName,
          });
        }
        revalidate();
      });

      (async () => {
        while (!unmounted) {
          // Stop polling when session is done
          const session = clipStateRef.current.sessions.find(
            (s) => s.id === effect.sessionId
          );
          if (session?.status === "done") {
            break;
          }
          try {
            const { insertionPoint, items } = clipStateRef.current;
            const clips = await clipService.appendFromObs({
              videoId,
              filePath: effect.outputPath,
              insertionPoint,
              items,
              silenceLength: effect.silenceLength,
            });
            if (clips.length > 0) {
              dispatch({
                type: "new-database-clips",
                clips: clips as DB.Clip[],
                outputPath: effect.outputPath,
              });
            }
          } catch (e) {
            // Errors are swallowed; polling continues
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      })();

      return () => {
        unmounted = true;
        unsubAck();
      };
    },
    "snapshot-for-clip": (_state, effect) => {
      sendToChild({
        type: "snapshotForClip",
        diagramId: effect.diagramId,
        clipId: effect.clipId,
      });
    },
    "persist-web-links": (_state, effect, dispatch) => {
      fetch(`/api/clips/${effect.clipId}/web-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: effect.links }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then((body: { webLinks: DB.ClipWebLink[] }) => {
          dispatch({
            type: "set-clip-web-links",
            clipId: effect.clipId,
            webLinks: body.webLinks,
          });
        })
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "persist-web-links",
            message:
              error instanceof Error
                ? error.message
                : "Failed to persist web links",
          });
        });
    },
    "delete-web-link": (_state, effect, dispatch) => {
      const clip = clipStateRef.current.items.find(
        (i) => i.type === "on-database" && i.frontendId === effect.clipId
      );
      const databaseClipId =
        clip?.type === "on-database" ? clip.databaseId : null;
      if (!databaseClipId) return;
      fetch(`/api/clips/${databaseClipId}/web-links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId: effect.linkId }),
      }).catch((error) => {
        dispatch({
          type: "effect-failed",
          effectType: "delete-web-link",
          message:
            error instanceof Error
              ? error.message
              : "Failed to delete web link",
        });
      });
    },
    "create-chapter-at": (_state, effect, dispatch) => {
      clipService
        .createChapterAtPosition({
          videoId,
          name: effect.name,
          position: effect.position,
          targetItemId: effect.targetItemId,
          targetItemType: effect.targetItemType,
        })
        .then((chapter) => {
          dispatch({
            type: "chapter-created",
            frontendId: effect.frontendId,
            databaseId: chapter.id as DatabaseId,
          });
        })
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "create-chapter-at",
            message:
              error instanceof Error
                ? error.message
                : "Failed to create chapter at position",
          });
        });
    },
    "create-effect-clip-at": (_state, effect, dispatch) => {
      clipService
        .createEffectClipAtPosition({
          videoId,
          position: effect.position,
          targetItemId: effect.targetItemId,
          targetItemType: effect.targetItemType,
          videoFilename: whiteNoiseAssetPath,
          sourceStartTime: effect.sourceStartTime,
          sourceEndTime: effect.sourceEndTime,
          text: effect.text,
          scene: effect.scene,
          profile: effect.profile,
          pauseType: effect.pauseType,
        })
        .then((clip) => {
          dispatch({
            type: "effect-clip-created",
            frontendId: effect.frontendId,
            databaseId: clip.id as DatabaseId,
          });
        })
        .catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "create-effect-clip-at",
            message:
              error instanceof Error
                ? error.message
                : "Failed to create effect clip",
          });
        });
    },
    "revalidate-loader": () => {
      revalidate();
    },
  };
}
