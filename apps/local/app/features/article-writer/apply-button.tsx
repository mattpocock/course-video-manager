import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The writer's Apply. Lint violations never block it: they only add the
 * orange warning, so a document can be applied with them still in it.
 * Unresolved screenshot placeholders do block it.
 */
export function ApplyButton(props: {
  onApply: () => void;
  isApplying: boolean;
  isGenerating: boolean;
  unresolvedScreenshots: boolean;
  lintCount: number;
}) {
  const { onApply, isApplying, isGenerating, unresolvedScreenshots } = props;
  return (
    <Button
      size="sm"
      onClick={onApply}
      disabled={isGenerating || isApplying || unresolvedScreenshots}
      title={applyTitle(props)}
    >
      {isApplying ? (
        <>
          <Loader2Icon className="mr-1 size-4 animate-spin" />
          Uploading images…
        </>
      ) : (
        <>
          {props.lintCount > 0 && (
            <AlertTriangleIcon
              className="mr-1 size-4 text-orange-500"
              aria-label="Has lint violations"
            />
          )}
          Apply
        </>
      )}
    </Button>
  );
}

function applyTitle(props: {
  unresolvedScreenshots: boolean;
  lintCount: number;
}): string | undefined {
  if (props.unresolvedScreenshots) {
    return "Resolve all screenshot placeholders before applying";
  }
  if (props.lintCount > 0) {
    return `Apply with ${props.lintCount} lint violation${props.lintCount > 1 ? "s" : ""}`;
  }
  return undefined;
}
