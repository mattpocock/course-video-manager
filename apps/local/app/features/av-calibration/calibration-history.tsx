import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SavedAVCalibration } from "./calibration-wire";
import { micOffsetColumn } from "./mic-offset-column";
import { toDate } from "@/packages/clock";

/**
 * The past AV Calibrations, newest first, passed and failed. Opening one
 * shows its result and its review timeline again.
 */
export const CalibrationHistory = ({
  calibrations,
  openId,
  disabled,
  onOpen,
}: {
  calibrations: SavedAVCalibration[];
  /** The calibration whose result is showing, if any. */
  openId: string | null;
  /** True while a session runs: nothing else may open. */
  disabled: boolean;
  onOpen: (calibration: SavedAVCalibration) => void;
}) => {
  const micOffsets = micOffsetColumn(calibrations);
  return (
    <div className="rounded-lg border p-6 space-y-3">
      <div className="text-xl font-semibold">Past calibrations</div>
      {calibrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y">
          {calibrations.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="tabular-nums">
                {toDate(c.createdAt).toLocaleString()}
              </span>
              <span
                className={cn(
                  "w-16 font-medium",
                  c.outcome === "passed" ? "text-emerald-500" : "text-red-500"
                )}
              >
                {c.outcome === "passed" ? "Passed" : "Failed"}
              </span>
              <span className="w-28 font-mono tabular-nums">
                {c.speechLufs.toFixed(1)} LUFS
              </span>
              <span className="w-24 whitespace-nowrap font-mono tabular-nums">
                {c.truePeakDb === null
                  ? "—"
                  : `${c.truePeakDb.toFixed(1)} dBTP`}
              </span>
              <span className="w-24 font-mono tabular-nums text-muted-foreground">
                {c.thresholdDb.toFixed(1)} dB
              </span>
              <span
                className="w-32 whitespace-nowrap font-mono tabular-nums"
                title="Mic Offset, and its change from the previous calibration that has one"
              >
                {micOffsets[i]}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || c.id === openId}
                onClick={() => onOpen(c)}
              >
                View timeline
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
