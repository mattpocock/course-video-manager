import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One line of a report: whether it went as asked, in words. */
export type ReportLine = { ok: boolean; words: string };

/**
 * One line of a report, ticked or warned: the New Broadcast form's and the
 * Broadcast thumbnail control's.
 */
export const ReportRow = ({ line }: { line: ReportLine }) => (
  <p
    className={cn(
      "flex gap-1 text-sm",
      line.ok ? "text-foreground" : "text-amber-600"
    )}
  >
    {line.ok ? (
      <CheckIcon className="size-4 shrink-0 mt-0.5 text-green-600" />
    ) : (
      <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
    )}
    <span>{line.words}</span>
  </p>
);
