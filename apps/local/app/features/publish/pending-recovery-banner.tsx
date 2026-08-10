import { Button } from "@/components/ui/button";
import type { PendingRecovery } from "@/services/pending-recovery.server";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

/**
 * The durable recovery surface for a crash-stranded Pending Version (#1404).
 * Receipt committed → the publish is already live externally, so Promote is
 * auto-submitted on render (never discard a committed version) and the banner
 * confirms recovery. Receipt absent → one-click Discard; the operator's edits
 * are safe in the current Draft and they republish normally.
 */
export function PendingRecoveryBanner({
  recovery,
}: {
  recovery: PendingRecovery | null;
}) {
  const fetcher = useFetcher();
  const promoteSubmitted = useRef(false);
  // Held locally so the "recovered ✓" confirmation survives the revalidation
  // that clears `recovery` after the Promote lands.
  const [recoveredName, setRecoveredName] = useState<string | null>(null);

  useEffect(() => {
    if (recovery?.receiptState === "committed" && !promoteSubmitted.current) {
      promoteSubmitted.current = true;
      setRecoveredName(recovery.versionName);
      fetcher.submit(
        { intent: "promote-pending", versionId: recovery.versionId },
        { method: "post" }
      );
    }
  }, [recovery, fetcher]);

  if (recoveredName !== null) {
    // Recovered only once the Promote actually landed — an errored action
    // must not read as success.
    const done =
      fetcher.state === "idle" &&
      (fetcher.data as { promotedVersionId?: string } | undefined)
        ?.promotedVersionId !== undefined;
    return (
      <div className="mb-8 rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-sm">
        <span className="font-medium text-green-500">
          {done
            ? `Publish finished — recovered ✓ ${recoveredName} is live.`
            : `Finalizing your interrupted publish of ${recoveredName}…`}
        </span>
        <p className="text-muted-foreground mt-1">
          The last publish committed to Dropbox but was interrupted before it
          was recorded here.{" "}
          {done ? "It is now marked Published." : "Marking it Published…"}
        </p>
      </div>
    );
  }

  if (!recovery) return null;

  if (recovery.receiptState === "unreadable") {
    // Never offer Discard on a receipt we could not read — the mount may be
    // down while the receipt (and a committed publish) actually exists.
    return (
      <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium text-amber-500">
            An interrupted publish ({recovery.versionName}) needs recovery
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          The Dropbox commit receipt (course.json) couldn&apos;t be read, so it
          is unknown whether that publish committed. Check the Dropbox mount and
          reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        <span className="text-sm font-medium text-amber-500">
          Your last publish ({recovery.versionName}) didn&apos;t finish
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        It never committed — the course.json receipt was never written, so
        consumers still see the previous release. Your edits are safe in the
        current draft. Discard the unfinished version, then publish again
        normally.
      </p>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="discard-pending" />
        <input type="hidden" name="versionId" value={recovery.versionId} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={fetcher.state !== "idle"}
        >
          {fetcher.state !== "idle"
            ? "Discarding…"
            : "Discard unfinished publish"}
        </Button>
      </fetcher.Form>
    </div>
  );
}
