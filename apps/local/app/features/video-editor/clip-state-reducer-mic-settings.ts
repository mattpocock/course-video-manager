import { DEFAULT_MIC_EQ, type MicEq } from "@cvm/core/features/videos/recorder";
import type { EffectReducerExec } from "use-effect-reducer";
import { MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE } from "@/services/recording-session-shared-message";
import type { clipStateReducer } from "./clip-state-reducer";
import { nowMs } from "@/packages/clock";

type MicSettingsSubmitted = Extract<
  clipStateReducer.Action,
  { type: "mic-settings-submitted" }
>;

const sameEq = (a: MicEq, b: MicEq) =>
  a.lowDb === b.lowDb && a.midDb === b.midDb && a.highDb === b.highDb;

/**
 * The Mic Settings dialog was saved on a CVM-recorder Clip. A changed offset
 * belongs to the Clip's Recording Session, so every Clip of that Session
 * replays against the shifted mic at once (no Clip moves: Clip times are the
 * picture's). A changed EQ is the one setting every Recording Session shares.
 * Only what changed is saved. An OBS Clip, or one not saved yet, is left
 * alone.
 */
export const handleMicSettingsSubmitted = (
  state: clipStateReducer.State,
  action: MicSettingsSubmitted,
  exec: EffectReducerExec<
    clipStateReducer.State,
    clipStateReducer.Action,
    clipStateReducer.Effect
  >
): clipStateReducer.State => {
  const item = state.items.find((i) => i.frontendId === action.clipId);
  if (!item || item.type !== "on-database" || !item.recordingSession) {
    return state;
  }
  const session = item.recordingSession;
  const offsetChanged = action.micOffsetMs !== session.micOffsetMs;
  const eqChanged = !sameEq(action.micEq, session.micEq ?? DEFAULT_MIC_EQ);
  if (!offsetChanged && !eqChanged) return state;

  if (offsetChanged) {
    exec({
      type: "update-mic-offset",
      clipId: item.databaseId,
      micOffsetMs: action.micOffsetMs,
      frontendClipId: item.frontendId,
      recordingSessionId: session.id,
      previousMicOffsetMs: session.micOffsetMs,
    });
  }
  if (eqChanged) {
    exec({ type: "update-mic-eq", micEq: action.micEq });
  }

  return {
    ...state,
    items: state.items.map((i) => {
      if (i.type !== "on-database" || !i.recordingSession) return i;
      const ofSession = i.recordingSession.id === session.id;
      if (!eqChanged && !ofSession) return i;
      return {
        ...i,
        recordingSession: {
          ...i.recordingSession,
          ...(ofSession && { micOffsetMs: action.micOffsetMs }),
          ...(eqChanged && { micEq: action.micEq }),
        },
      };
    }),
  };
};

type MicOffsetSaveFailed = Extract<
  clipStateReducer.Action,
  { type: "mic-offset-save-failed" }
>;

/**
 * Saving a mic offset failed. Refused because a Version that is not a Draft
 * shares the Recording Session (issue #2010): put the Session's offset back
 * and reopen the Mic Settings dialog to say why. Any other failure leaves the
 * editor out of step with the database, so it is fatal like every other.
 */
export const handleMicOffsetSaveFailed = (
  state: clipStateReducer.State,
  action: MicOffsetSaveFailed
): clipStateReducer.State => {
  if (action.message !== MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE) {
    return {
      ...state,
      error: {
        message: action.message,
        effectType: "update-mic-offset",
        timestamp: nowMs(),
      },
    };
  }
  const { effect } = action;
  return {
    ...state,
    micOffsetRefusal: {
      clipId: effect.frontendClipId,
      message: action.message,
    },
    items: state.items.map((i) =>
      i.type === "on-database" &&
      i.recordingSession?.id === effect.recordingSessionId
        ? {
            ...i,
            recordingSession: {
              ...i.recordingSession,
              micOffsetMs: effect.previousMicOffsetMs,
            },
          }
        : i
    ),
  };
};
