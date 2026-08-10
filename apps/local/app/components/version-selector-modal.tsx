import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Version {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
}

interface VersionSelectorModalProps {
  versions: Version[];
  selectedVersionId: string | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectVersion: (versionId: string) => void;
}

export function VersionSelectorModal({
  versions,
  selectedVersionId,
  isOpen,
  onOpenChange,
  onSelectVersion,
}: VersionSelectorModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Version</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-4 overflow-y-auto max-h-[60vh]">
          {versions.map((version) => {
            const isSelected = version.id === selectedVersionId;
            return (
              <Button
                key={version.id}
                variant="ghost"
                className={cn(
                  "w-full justify-between h-auto py-2",
                  isSelected && "bg-accent"
                )}
                onClick={() => {
                  onSelectVersion(version.id);
                  onOpenChange(false);
                }}
              >
                <div className="flex flex-col items-start text-left min-w-0 overflow-hidden">
                  <span className="truncate w-full">
                    {version.name || <span className="italic">Draft</span>}{" "}
                    <span className="text-muted-foreground">
                      ({new Date(version.createdAt).toLocaleDateString()})
                    </span>
                  </span>
                  {version.description && (
                    <span className="text-xs text-muted-foreground line-clamp-2 text-wrap">
                      {version.description}
                    </span>
                  )}
                  {version.name && (
                    <span className="text-xs text-muted-foreground">
                      Published (read-only)
                    </span>
                  )}
                </div>
                {isSelected && <Check className="w-4 h-4 shrink-0" />}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
