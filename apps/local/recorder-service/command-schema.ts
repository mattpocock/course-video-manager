import { Either, Schema } from "effect";
import type { VideoFormat } from "@/features/videos/video-format";
import { SCENES } from "../app/packages/scene-layout";
import { CALIBRATION_REQUIRED, type RecorderCommand } from "./protocol";

/**
 * What the recorder service accepts on its WebSocket: every `RecorderCommand`
 * (`protocol.ts`), decoded from JSON. Anything else is logged and dropped.
 */

const FORMATS = ["landscape", "short"] as const satisfies VideoFormat[];

const CalibrationWindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

/** Record's AV Calibration (none: null): the gate's, and its threshold. */
const calibration = {
  calibration: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      createdAtMs: Schema.Number,
      thresholdDb: Schema.Number,
      recorderMic: Schema.String,
      cameraDevice: Schema.NullOr(Schema.String),
    })
  ),
};

const RecordWith = {
  silenceLength: Schema.Literal("short", "long"),
  folder: Schema.String,
  ...calibration,
};

const Command = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("open"),
    videoId: Schema.String,
    format: Schema.optional(Schema.Literal(...FORMATS)),
  }),
  Schema.Struct({
    type: Schema.Literal("record"),
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
    ...calibration,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("retry-camera") }),
  Schema.Struct({ type: Schema.Literal("retry-screen") }),
  Schema.Struct({
    type: Schema.Literal("switch-scene"),
    scene: Schema.Literal(...SCENES),
  }),
  Schema.Struct({
    type: Schema.Literal("prepare-record"),
    videoId: Schema.String,
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
    ...calibration,
  }),
  Schema.Struct({
    type: Schema.Literal("stream-deck"),
    press: Schema.Union(
      Schema.Struct({
        action: Schema.Literal("record", "stop", "toggle-record"),
      }),
      Schema.Struct({
        action: Schema.Literal("switch-scene"),
        scene: Schema.Literal(...SCENES),
      })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("replay"),
    recordingSessionId: Schema.String,
    afterSeq: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("start-meter", "stop-meter") }),
  Schema.Struct({
    type: Schema.Literal("start-calibration"),
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("finish-calibration"),
    silence: CalibrationWindowSchema,
    speech: Schema.Array(CalibrationWindowSchema),
    claps: CalibrationWindowSchema,
  }),
  Schema.Struct({ type: Schema.Literal("cancel-calibration") }),
  Schema.Struct({
    type: Schema.Literal("start-stream"),
    broadcastId: Schema.String,
    streamKey: Schema.NonEmptyString,
    micOffsetMs: Schema.Number,
    micEq: Schema.Struct({
      lowDb: Schema.Number,
      midDb: Schema.Number,
      highDb: Schema.Number,
    }),
    record: Schema.Struct(RecordWith),
  }),
  Schema.Struct({ type: Schema.Literal("end-stream") }),
  Schema.Struct({
    type: Schema.Literal("show-highlight"),
    highlightId: Schema.String,
    broadcastId: Schema.String,
    messageId: Schema.String,
    author: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("hide-highlight"),
    highlightId: Schema.String,
  })
);
export const decodeCommand = Schema.decodeUnknownEither(
  Schema.parseJson(Command)
);

/**
 * The first 200 characters of a command that did not decode, for the log,
 * with any Stream Key in it blanked out: a `start-stream` cut short or
 * malformed still carries one, and it must never reach a log.
 */
export const excerptOfUndecodable = (raw: string) =>
  raw
    .replace(/("streamKey"\s*:\s*")(?:[^"\\]|\\.)*("?)/g, "$1<redacted>$2")
    .slice(0, 200);

/**
 * A command that did not decode but must be answered, not dropped: a Record
 * (or the Stream Deck's prepare-record) with no `calibration`, from an app
 * server older than the AV Calibration gate, or with a calibration that
 * names no camera, from one older than the camera + mic gate (protocol 12).
 * Its sender hears why.
 */
export const refusalOfUndecodable = (
  raw: string
): { command: RecorderCommand["type"]; message: string } | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { type, calibration } = parsed as Record<string, unknown>;
  const namesNoCamera =
    typeof calibration === "object" &&
    calibration !== null &&
    !("cameraDevice" in calibration);
  if (
    (type === "record" || type === "prepare-record") &&
    (!("calibration" in parsed) || namesNoCamera)
  )
    return { command: type, message: CALIBRATION_REQUIRED };
  return undefined;
};

/**
 * A message off the WebSocket: the command it is, or the refusal its sender
 * must hear, or neither (logged, its Stream Key blanked, and dropped).
 */
export const readCommand = (
  raw: string
):
  | { command: RecorderCommand }
  | { refusal: { command: RecorderCommand["type"]; message: string } }
  | undefined => {
  const decoded = decodeCommand(raw);
  if (Either.isRight(decoded)) return { command: decoded.right };
  const refusal = refusalOfUndecodable(raw);
  if (refusal) return { refusal };
  console.error(`recorder: unreadable command ${excerptOfUndecodable(raw)}`);
  return undefined;
};
