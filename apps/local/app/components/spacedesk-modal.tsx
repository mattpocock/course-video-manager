import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { buildFullIp, isValidSuffix, STORAGE_KEY } from "@/lib/spacedesk-ip";
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

interface SpacedeskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpacedeskModal({ open, onOpenChange }: SpacedeskModalProps) {
  const [savedSuffix, setSavedSuffix] = useLocalStorage(STORAGE_KEY);
  const [suffix, setSuffix] = useState("");
  const fetcher = useFetcher<
    { success: true } | { success: false; message: string }
  >();

  useEffect(() => {
    if (open) {
      setSuffix(savedSuffix);
    }
  }, [open, savedSuffix]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      toast("Space Desk display is waking up…");
      onOpenChange(false);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data, onOpenChange]);

  const valid = isValidSuffix(suffix);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSavedSuffix(suffix);
    fetcher.submit(JSON.stringify({ ip: buildFullIp(suffix) }), {
      method: "post",
      action: "/api/spacedesk/open",
      encType: "application/json",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Space Desk</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="spacedesk-ip">Server IP</Label>
            <div className="flex items-center gap-0">
              <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground select-none">
                192.168.
              </span>
              <Input
                id="spacedesk-ip"
                className="rounded-l-none"
                placeholder="1.100"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
