import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVideoCopyOptions } from "@/features/video-editor/hooks/use-video-copy-options";
import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useFetcher } from "react-router";

export function CopyVideoModal(props: {
  videoId: string;
  videoTitle: string;
  clipCount: number;
  beatCount: number;
  hasScript: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy?: () => void;
}) {
  const fetcher = useFetcher();
  const [options, setOptions] = useVideoCopyOptions();
  const copyClipsDisabled = props.clipCount === 0;
  const copyBeatsDisabled = props.beatCount === 0;
  const copyScriptDisabled = !props.hasScript;

  // Track checkbox state with refs so we can read them on submit without
  // needing controlled inputs (mirrors the uncontrolled pattern of the name input).
  // We show the stored preference but force false when the count is zero.
  const copyClipsChecked = copyClipsDisabled ? false : options.copyClips;
  const copyBeatsChecked = copyBeatsDisabled ? false : options.copyBeats;
  const copyScriptChecked = copyScriptDisabled ? false : options.copyScript;

  const copyClipsRef = useRef(copyClipsChecked);
  copyClipsRef.current = copyClipsChecked;
  const copyBeatsRef = useRef(copyBeatsChecked);
  copyBeatsRef.current = copyBeatsChecked;

  const [renameOld, setRenameOld] = useState(options.renameOld);
  const [nameEdited, setNameEdited] = useState(false);
  const defaultName = renameOld
    ? props.videoTitle
    : `${props.videoTitle} (copy)`;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Video</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action={`/api/videos/${props.videoId}/copy`}
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);

            // Persist the user's expressed intent (only when not disabled).
            // A disabled checkbox is forced to false but we don't overwrite the
            // stored preference — the user didn't express a different intent.
            const newCopyClips = copyClipsDisabled
              ? options.copyClips
              : formData.get("copyClips") === "on";
            const newCopyBeats = copyBeatsDisabled
              ? options.copyBeats
              : formData.get("copyBeats") === "on";
            const newCopyScript = copyScriptDisabled
              ? options.copyScript
              : formData.get("copyScript") === "on";

            setOptions({
              copyClips: newCopyClips,
              copyBeats: newCopyBeats,
              copyScript: newCopyScript,
              renameOld: formData.get("renameOld") === "on",
            });

            await fetcher.submit(e.currentTarget);
            if (props.onCopy) {
              props.onCopy();
            } else {
              props.onOpenChange(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="copy-video-name">New Video Name</Label>
            <Input
              id="copy-video-name"
              name="name"
              key={nameEdited ? "edited" : defaultName}
              defaultValue={defaultName}
              onChange={() => setNameEdited(true)}
              required
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rename-old"
                name="renameOld"
                checked={renameOld}
                onCheckedChange={(checked) => {
                  setRenameOld(checked === true);
                  setNameEdited(false);
                }}
              />
              <Label htmlFor="rename-old">
                Rename old video to &ldquo;(old)&rdquo;
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="copy-clips"
                name="copyClips"
                defaultChecked={copyClipsChecked}
                disabled={copyClipsDisabled}
              />
              <Label
                htmlFor="copy-clips"
                className={copyClipsDisabled ? "text-muted-foreground" : ""}
              >
                Copy clips &amp; chapters ({props.clipCount})
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="copy-beats"
                name="copyBeats"
                defaultChecked={copyBeatsChecked}
                disabled={copyBeatsDisabled}
              />
              <Label
                htmlFor="copy-beats"
                className={copyBeatsDisabled ? "text-muted-foreground" : ""}
              >
                Copy beats ({props.beatCount})
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="copy-script"
                name="copyScript"
                defaultChecked={copyScriptChecked}
                disabled={copyScriptDisabled}
              />
              <Label
                htmlFor="copy-script"
                className={copyScriptDisabled ? "text-muted-foreground" : ""}
              >
                Copy script
              </Label>
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit">
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Copy"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
