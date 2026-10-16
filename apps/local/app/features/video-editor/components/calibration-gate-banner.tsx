import { Link } from "react-router";
import { MicOffIcon } from "lucide-react";
import {
  AV_CALIBRATION_PATH,
  describeCalibrationRefusal,
  type CalibrationValidity,
} from "@/av-calibration-constants";

/**
 * THE GATE's banner on the Record controls (ADR 0038): why recording
 * will not start, and the way to the AV Calibration page. `refusal` is a
 * refusal already met (the recorder service said no), shown even
 * when the gate looks open from here (the recorder's mic changed).
 */
export const CalibrationGateBanner = (props: {
  gate: CalibrationValidity;
  refusal?: string | null;
}) => {
  const message = !props.gate.valid
    ? describeCalibrationRefusal(props.gate.reason)
    : props.refusal;
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid="calibration-gate-banner"
      className="flex w-full max-w-xl items-start gap-3 rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200"
    >
      <MicOffIcon className="size-5 shrink-0 text-amber-500" />
      <p className="flex-1">
        {message} Recording is blocked until one passes.{" "}
        <Link
          to={AV_CALIBRATION_PATH}
          className="font-semibold underline underline-offset-2"
        >
          Run an AV Calibration
        </Link>
      </p>
    </div>
  );
};
