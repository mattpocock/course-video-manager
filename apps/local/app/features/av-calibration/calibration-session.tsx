import { Button } from "@/components/ui/button";
import {
  LOUD_LINE,
  MAX_TRUE_PEAK_DBTP,
  READ_SECONDS,
  PAUSE_SECONDS,
  SCRIPT_END_SECONDS,
  SCRIPT_LINES,
  SILENCE_SECONDS,
  TARGET_BAND,
  type CalibrationMiss,
  type ScriptStep,
} from "@/av-calibration-constants";
import { cn } from "@/lib/utils";
import { CheckCircle2, Ear, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import {
  currentStep,
  liveClaps,
  type avCalibrationReducer,
} from "./av-calibration-reducer";
import { CalibrationTimelineView } from "./calibration-timeline-view";
import { ClapStepView } from "./clap-step";
import type { SavedAVCalibration } from "./calibration-wire";

type State = avCalibrationReducer.State;

const dB = (n: number) => `${n.toFixed(1)} dB`;

const PROMPT: Record<ScriptStep["kind"], string> = {
  countdown: "Get ready",
  silence: "Stay quiet",
  "clap-ready": "Hands in front of your face",
  clap: "Clap",
  read: "Read line",
  pause: "Pause",
  loud: "Read it loud",
};

const PROMPT_STYLE: Record<ScriptStep["kind"], string> = {
  countdown: "text-muted-foreground",
  silence: "text-sky-400",
  "clap-ready": "text-violet-400",
  clap: "text-violet-400",
  read: "text-emerald-400",
  pause: "text-amber-400",
  loud: "text-red-400",
};

/** The step on screen during a run: the prompt, its countdown, the line to read. */
const Prompt = ({ state }: { state: State }) => {
  const now = currentStep(state);
  if (!now)
    return (
      <div className="flex items-center gap-3 text-2xl text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
        Opening the camera and mic…
      </div>
    );
  const { step, remainingSeconds } = now;
  const line = step.kind === "read" || step.kind === "pause" ? step.line : null;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-6">
        <div className={cn("text-4xl font-bold", PROMPT_STYLE[step.kind])}>
          {PROMPT[step.kind]}
          {step.kind === "read" && ` ${line}`}
        </div>
        <div className="font-mono tabular-nums text-6xl font-semibold">
          {Math.ceil(remainingSeconds)}
        </div>
      </div>
      <div className="min-h-[4.5rem] text-2xl leading-snug">
        {step.kind === "read" && <q>{SCRIPT_LINES[step.line - 1]}</q>}
        {step.kind === "loud" && (
          <div className="space-y-2">
            <q>{LOUD_LINE}</q>
            <p className="text-base text-muted-foreground">
              As loudly as you get when you are excited.
            </p>
          </div>
        )}
        {step.kind === "pause" && (
          <span className="text-muted-foreground">
            {line === SCRIPT_LINES.length
              ? "Next: one line, read loudly."
              : `Next: line ${line! + 1}.`}
          </span>
        )}
        {step.kind === "silence" && (
          <span className="text-muted-foreground">
            Measuring the room. Keep still and say nothing.
          </span>
        )}
        {step.kind === "clap-ready" && (
          <span className="text-muted-foreground">
            On camera, hands apart, ready. Clap once, sharply, when Clap comes
            up.
          </span>
        )}
        {step.kind === "clap" && (
          <span className="text-muted-foreground">Then read the lines.</span>
        )}
        {step.kind === "countdown" && (
          <span className="text-muted-foreground">
            {SILENCE_SECONDS} s of silence first.
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * The clap step's live marks: each clap as the mic hears it, and whether the
 * camera saw the hands meet. Only a clap both heard and seen counts.
 */
const ClapMarks = ({ state }: { state: State }) => {
  const claps = liveClaps(state);
  if (!claps) return null;
  const seen = claps.filter((c) => c.seen).length;
  return (
    <div className="space-y-2" data-testid="live-claps">
      <div className="flex flex-wrap gap-2 min-h-10">
        {claps.length === 0 && (
          <span className="self-center text-muted-foreground">
            Listening for claps…
          </span>
        )}
        {claps.map((clap, i) => (
          <div
            key={clap.audioS}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
              clap.seen
                ? "border-emerald-500/60 text-emerald-400"
                : "border-amber-500/60 text-amber-400"
            )}
          >
            <span className="font-semibold">Clap {i + 1}</span>
            <Ear className="w-4 h-4" aria-label="heard" />
            {clap.seen ? (
              <Eye className="w-4 h-4" aria-label="seen" />
            ) : (
              <EyeOff className="w-4 h-4" aria-label="not seen" />
            )}
            <span>{clap.seen ? "heard and seen" : "heard, not seen"}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {seen > 0 ? "Heard and seen." : "Not heard and seen yet."} After the
        session you line up the clap by eye and ear in the clap step.
      </p>
    </div>
  );
};

/** How far through the script the run is. */
const Progress = ({ seconds }: { seconds: number }) => (
  <div className="h-1.5 rounded bg-muted overflow-hidden">
    <div
      className="h-full bg-emerald-500 transition-[width]"
      style={{
        width: `${Math.min(100, (seconds / SCRIPT_END_SECONDS) * 100)}%`,
      }}
    />
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="font-mono tabular-nums text-2xl font-semibold">{value}</div>
  </div>
);

const missTitle = (miss: CalibrationMiss) => {
  switch (miss.kind) {
    case "no-mic-offset":
      return "Clap step not saved";
    case "too-quiet":
      return `Too quiet by ${dB(miss.byDb)}`;
    case "too-loud":
      return `Too loud by ${dB(miss.byDb)}`;
    case "peak-too-high":
      return `Peaked at ${miss.truePeakDb.toFixed(1)} dBTP, ${dB(miss.byDb)} over the ${MAX_TRUE_PEAK_DBTP} dBTP ceiling`;
  }
};

const missAdvice = (miss: CalibrationMiss) => {
  switch (miss.kind) {
    case "too-quiet":
      return "Turn your level up until the meter sits in the band, then run it again.";
    case "too-loud":
      return "Turn your level down until the meter sits in the band, then run it again.";
    case "peak-too-high":
      return "Your loudest moment would come close to clipping: turn your level down, then run it again.";
    case "no-mic-offset":
      return "Line up a clap in the clap step and save its Mic Offset.";
  }
};

const Result = ({ calibration }: { calibration: SavedAVCalibration }) => {
  const { judgement } = calibration;
  return (
    <div className="space-y-5">
      {judgement.outcome === "passed" ? (
        <div className="flex items-center gap-3 text-3xl font-bold text-emerald-500">
          <CheckCircle2 className="w-8 h-8" />
          Passed
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-3xl font-bold text-red-500">
            <XCircle className="w-8 h-8" />
            Failed
          </div>
          <ul className="space-y-1">
            {judgement.misses.map((miss) => (
              <li key={miss.kind}>
                <span className="font-semibold">{missTitle(miss)}.</span>{" "}
                <span className="text-muted-foreground">
                  {missAdvice(miss)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-5 gap-6">
        <Stat
          label="Speech loudness"
          value={`${calibration.speechLufs.toFixed(1)} LUFS`}
        />
        <Stat
          label="True peak"
          value={
            calibration.truePeakDb === null
              ? "—"
              : `${calibration.truePeakDb.toFixed(1)} dBTP`
          }
        />
        <Stat
          label="Mic Offset"
          value={
            calibration.micOffsetMs === null
              ? "—"
              : `${Math.round(calibration.micOffsetMs)} ms`
          }
        />
        <Stat
          label="Noise floor"
          value={`${calibration.noiseFloorDb.toFixed(1)} dBFS`}
        />
        <Stat label="Silence threshold" value={dB(calibration.thresholdDb)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Target band {TARGET_BAND.lowLufs} to {TARGET_BAND.highLufs} LUFS; true
        peak at most {MAX_TRUE_PEAK_DBTP} dBTP; then the clap step saved. Stored{" "}
        {new Date(calibration.createdAt).toLocaleString()}, on{" "}
        {calibration.recorderMic}
        {calibration.cameraDevice ? ` and ${calibration.cameraDevice}` : ""}
        {calibration.browserInputLabel
          ? `; browser input ${calibration.browserInputLabel}`
          : "; no browser input"}
        .
      </p>
    </div>
  );
};

/** What the browser detector is listening to during a run. */
const BrowserInput = ({ state }: { state: State }) => {
  const { label, problem } = state.browser;
  if (label)
    return (
      <p className="text-sm text-muted-foreground">
        Browser detector listening to {label}.
      </p>
    );
  if (problem)
    return (
      <p className="text-sm text-amber-500">
        No browser trace for this run: {problem}
      </p>
    );
  return null;
};

/**
 * The scripted session of an AV Calibration: Start from the meter, the
 * prompts and their countdowns, then the result. Every decision is the
 * reducer's; this only draws it.
 */
export const CalibrationSession = ({
  state,
  onStart,
  onCancel,
  onBackToMeter,
  dispatch,
}: {
  state: State;
  onStart: () => void;
  onCancel: () => void;
  onBackToMeter: () => void;
  dispatch: (action: avCalibrationReducer.Action) => void;
}) => {
  const session = state.session;
  return (
    <div className="rounded-lg border p-6 space-y-5">
      {session.kind === "meter" && (
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-xl font-semibold">
              Run the scripted session
            </div>
            <p className="text-muted-foreground">
              About {Math.round(SCRIPT_END_SECONDS)} s, on camera:{" "}
              {SILENCE_SECONDS} s of silence, one clap with your hands in front
              of your face, then {SCRIPT_LINES.length} rounds of reading a line
              ({READ_SECONDS} s) and pausing ({PAUSE_SECONDS} s), then one line
              read loudly.
            </p>
          </div>
          <Button
            size="lg"
            onClick={onStart}
            disabled={state.meter.status !== "running"}
          >
            Start
          </Button>
        </div>
      )}

      {(session.kind === "starting" || session.kind === "running") && (
        <>
          <Prompt state={state} />
          <ClapMarks state={state} />
          <Progress
            seconds={session.kind === "running" ? session.seconds : 0}
          />
          <div className="flex items-center justify-between gap-6">
            <BrowserInput state={state} />
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {session.kind === "analysing" && (
        <div className="flex items-center gap-3 text-2xl text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          Measuring your mic…
        </div>
      )}

      {session.kind === "result" && (
        <>
          <Result calibration={session.calibration} />
          {session.clapStep && (
            <ClapStepView
              calibrationId={session.calibration.id}
              step={session.clapStep}
              dispatch={dispatch}
            />
          )}
          <CalibrationTimelineView timeline={session.timeline} />
          <Button
            variant={
              session.calibration.outcome === "passed" ? "outline" : "default"
            }
            onClick={onBackToMeter}
          >
            Back to the meter
          </Button>
        </>
      )}

      {session.kind === "camera-busy" && (
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="text-xl font-semibold text-amber-500">
              Close OBS to calibrate
            </div>
            <p className="text-sm text-muted-foreground">
              Another program has the Cam Link, so the session did not start and
              nothing was recorded. Close OBS, then press Start.
            </p>
          </div>
          <Button
            size="lg"
            onClick={onStart}
            disabled={state.meter.status !== "running"}
          >
            Start
          </Button>
        </div>
      )}

      {session.kind === "failed" && (
        <div className="space-y-3">
          <div className="text-xl font-semibold text-red-500">
            The session stopped
          </div>
          <p className="text-sm">{session.message}</p>
          <Button onClick={onBackToMeter}>Back to the meter</Button>
        </div>
      )}
    </div>
  );
};
