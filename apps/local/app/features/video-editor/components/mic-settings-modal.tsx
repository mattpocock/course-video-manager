import {
  DEFAULT_MIC_EQ,
  MIC_EQ_DB_RANGE,
  MIC_OFFSET_MS_RANGE,
  type MicEq,
} from "@cvm/core/features/videos/recorder";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ClipRecordingSession } from "@/packages/clip-source";

const EQ_BANDS = [
  { key: "lowDb", label: "Low (dB)" },
  { key: "midDb", label: "Mid (dB)" },
  { key: "highDb", label: "High (dB)" },
] as const;

/**
 * Mic Settings on a CVM-recorder Clip: its Recording Session's mic offset
 * (lip sync, set once after a clap test) and the mic EQ every CVM-recorder
 * Video is exported with. The fields are uncontrolled — the form is read once,
 * on Save, and what changed is the clip reducer's decision
 * (`mic-settings-submitted`). Raw Footage is never changed; the Videos need a
 * new export.
 */
export function MicSettingsModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordingSession: ClipRecordingSession | null;
  /** Why the last offset saved was refused, shown under the offset. */
  refusal: string | null;
  onSubmit: (settings: { micOffsetMs: number; micEq: MicEq }) => void;
}) {
  const session = props.recordingSession;
  const micEq = session?.micEq ?? DEFAULT_MIC_EQ;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const read = (name: string) => Number(form.get(name));
    props.onSubmit({
      micOffsetMs: read("micOffsetMs"),
      micEq: {
        lowDb: read("lowDb"),
        midDb: read("midDb"),
        highDb: read("highDb"),
      },
    });
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open && !!session} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mic Settings</DialogTitle>
          <DialogDescription>
            Applied at export; the raw Footage is never changed. Changing either
            makes the Video need a new export.
          </DialogDescription>
        </DialogHeader>
        {session && (
          <form
            // Re-read the saved values each time the dialog opens on a Session.
            key={`${session.id}:${session.micOffsetMs}:${JSON.stringify(micEq)}`}
            className="space-y-4 py-2"
            onSubmit={handleSubmit}
          >
            <div className="space-y-2">
              <Label htmlFor="mic-offset-ms">Mic offset (ms)</Label>
              <Input
                id="mic-offset-ms"
                name="micOffsetMs"
                type="number"
                step={1}
                min={MIC_OFFSET_MS_RANGE.min}
                max={MIC_OFFSET_MS_RANGE.max}
                defaultValue={session.micOffsetMs}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                For every Clip of this Recording Session. The mic is shifted
                later by this much; no Clip moves.
              </p>
              {props.refusal && (
                <p role="alert" className="text-xs text-red-400">
                  {props.refusal}
                </p>
              )}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Mic EQ</legend>
              <div className="grid grid-cols-3 gap-2">
                {EQ_BANDS.map((band) => (
                  <div key={band.key} className="space-y-1">
                    <Label htmlFor={`mic-eq-${band.key}`}>{band.label}</Label>
                    <Input
                      id={`mic-eq-${band.key}`}
                      name={band.key}
                      type="number"
                      step={0.1}
                      min={MIC_EQ_DB_RANGE.min}
                      max={MIC_EQ_DB_RANGE.max}
                      defaultValue={micEq[band.key]}
                      required
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                For every CVM recorder Clip. Old OBS Clips are unaffected.
              </p>
            </fieldset>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
