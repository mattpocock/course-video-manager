import type { DB } from "@/db/schema";
import type { Brand } from "./utils";

export type DatabaseId = Brand<string, "DatabaseId">;
export type FrontendId = Brand<string, "FrontendId">;

export type ClipOnDatabase = {
  type: "on-database";
  frontendId: FrontendId;
  databaseId: DatabaseId;
  videoFilename: string;
  sourceStartTime: number; // Start time in source video (seconds)
  sourceEndTime: number; // End time in source video (seconds)
  text: string;
  transcribedAt: Date | null;
  scene: string | null;
};

export type ClipOptimisticallyAdded = {
  type: "optimistically-added";
  frontendId: FrontendId;
  scene: string;
  /**
   * If true, when the optimistically added clip is replaced with the database clip,
   * the clip will be archived. Allows the user to delete the clip before it's transcribed.
   */
  shouldArchive?: boolean;
};

export const createFrontendId = (): FrontendId => {
  return crypto.randomUUID() as FrontendId;
};

export type Clip = ClipOnDatabase | ClipOptimisticallyAdded;

type State = {
  clips: Clip[];
  clipIdsBeingTranscribed: Set<FrontendId>;
};

type Action =
  | {
      type: "new-optimistic-clip-detected";
      scene: string;
    }
  | {
      type: "new-database-clips";
      clips: DB.Clip[];
    }
  | {
      type: "clips-deleted";
      clipIds: FrontendId[];
    }
  | {
      type: "clips-transcribed";
      clips: {
        databaseId: DatabaseId;
        text: string;
      }[];
    };

type Effect =
  | {
      type: "transcribe-clips";
      clipIds: DatabaseId[];
    }
  | {
      type: "archive-clips";
      clipIds: DatabaseId[];
    }
  | {
      type: "scroll-to-bottom";
    }
  | {
      type: "update-clips-scene";
      clips: [DatabaseId, string][];
    };

export const clipStateReducer =
  (reportEffect: (effect: Effect) => void) =>
  (state: State, action: Action): State => {
    switch (action.type) {
      case "new-optimistic-clip-detected": {
        reportEffect({
          type: "scroll-to-bottom",
        });
        return {
          ...state,
          clips: [
            ...state.clips,
            {
              type: "optimistically-added",
              frontendId: createFrontendId(),
              scene: action.scene,
            },
          ],
        };
      }
      case "new-database-clips": {
        let shouldScrollToBottom = false;

        const clips: (Clip | undefined)[] = [...state.clips];

        const clipsToArchive = new Set<DatabaseId>();
        const databaseClipIdsToTranscribe = new Set<DatabaseId>();
        const frontendClipIdsToTranscribe = new Set<FrontendId>();
        const clipsToUpdateScene = new Map<DatabaseId, string>();

        for (const databaseClip of action.clips) {
          // Find the first optimistically added clip
          const index = clips.findIndex(
            (c) => c?.type === "optimistically-added"
          );
          if (index !== -1) {
            const frontendClip = clips[index]!;
            if (
              frontendClip.type === "optimistically-added" &&
              frontendClip.shouldArchive
            ) {
              clipsToArchive.add(databaseClip.id);
              clips[index] = undefined;
            } else if (frontendClip.type === "optimistically-added") {
              clips[index] = {
                ...databaseClip,
                type: "on-database",
                frontendId: frontendClip.frontendId,
                databaseId: databaseClip.id,
                scene: frontendClip.scene,
              };
              clipsToUpdateScene.set(databaseClip.id, frontendClip.scene);
              frontendClipIdsToTranscribe.add(frontendClip.frontendId);
              databaseClipIdsToTranscribe.add(databaseClip.id);
            }
          } else {
            const newFrontendId = createFrontendId();
            // If no optimistically added clip is found, add a new one
            clips.push({
              type: "on-database",
              ...databaseClip,
              frontendId: newFrontendId,
              databaseId: databaseClip.id,
            });
            frontendClipIdsToTranscribe.add(newFrontendId);
            databaseClipIdsToTranscribe.add(databaseClip.id);
            shouldScrollToBottom = true;
          }
        }

        if (clipsToUpdateScene.size > 0) {
          reportEffect({
            type: "update-clips-scene",
            clips: Array.from(clipsToUpdateScene.entries()),
          });
        }

        if (shouldScrollToBottom) {
          reportEffect({
            type: "scroll-to-bottom",
          });
        }

        if (clipsToArchive.size > 0) {
          reportEffect({
            type: "archive-clips",
            clipIds: Array.from(clipsToArchive),
          });
        }

        if (databaseClipIdsToTranscribe.size > 0) {
          reportEffect({
            type: "transcribe-clips",
            clipIds: Array.from(databaseClipIdsToTranscribe),
          });
        }

        return {
          ...state,
          clipIdsBeingTranscribed: new Set([
            ...Array.from(state.clipIdsBeingTranscribed),
            ...Array.from(frontendClipIdsToTranscribe),
          ]),
          clips: clips.filter((c) => c !== undefined),
        };
      }
      case "clips-deleted": {
        const clipsToArchive = new Set<DatabaseId>();
        const clips: (Clip | undefined)[] = [...state.clips];
        for (const clipId of action.clipIds) {
          const index = clips.findIndex((c) => c?.frontendId === clipId);
          if (index === -1) continue;

          const clipToReplace = clips[index]!;
          if (clipToReplace.type === "optimistically-added") {
            clips[index] = { ...clipToReplace, shouldArchive: true };
          } else if (clipToReplace.type === "on-database") {
            clipsToArchive.add(clipToReplace.databaseId);
            clips[index] = undefined;
          }
        }

        if (clipsToArchive.size > 0) {
          reportEffect({
            type: "archive-clips",
            clipIds: Array.from(clipsToArchive),
          });
        }
        return {
          ...state,
          clips: clips.filter((c) => c !== undefined),
        };
      }
      case "clips-transcribed": {
        const set = new Set([...state.clipIdsBeingTranscribed]);

        const textMap: Record<DatabaseId, string> = action.clips.reduce(
          (acc, clip) => {
            acc[clip.databaseId] = clip.text;
            return acc;
          },
          {} as Record<DatabaseId, string>
        );

        return {
          ...state,
          clips: state.clips.map((clip) => {
            if (clip.type === "on-database" && textMap[clip.databaseId]) {
              set.delete(clip.frontendId);
              return { ...clip, text: textMap[clip.databaseId]! };
            }
            return clip;
          }),
          clipIdsBeingTranscribed: set,
        };
      }
    }
    return state;
  };
