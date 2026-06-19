import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFetcher, useLocation } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const ADD_MORE_STORAGE_KEY = "feedback-modal-add-more";

export function FeedbackModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const fetcher = useFetcher();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevState = useRef(fetcher.state);
  const [addMore, setAddMore] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(ADD_MORE_STORAGE_KEY) === "true";
    }
    return false;
  });

  const focusTextarea = useCallback(() => {
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (props.open) {
      focusTextarea();
    }
  }, [props.open, focusTextarea]);

  const addMoreRef = useRef(addMore);
  addMoreRef.current = addMore;

  const onOpenChangeRef = useRef(props.onOpenChange);
  onOpenChangeRef.current = props.onOpenChange;

  // Notify parent of submitting state changes
  useEffect(() => {
    props.onSubmittingChange?.(fetcher.state !== "idle");
  }, [fetcher.state, props.onSubmittingChange]);

  // Show toast when the response comes back in the background
  useEffect(() => {
    if (prevState.current === "loading" && fetcher.state === "idle") {
      if (fetcher.data && "success" in fetcher.data) {
        const openCount = (fetcher.data as { openIssueCount?: number | null })
          .openIssueCount;
        const countMsg = openCount != null ? ` ${openCount} open issues.` : "";
        toast(`Feedback submitted! Thank you.${countMsg}`, {
          action: {
            label: "Add more",
            onClick: () => onOpenChangeRef.current(true),
          },
        });
      }
    }
    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  // Close modal (or reset form) on submit
  // Defer reset so the fetcher captures form data before clearing
  const handleSubmit = useCallback(() => {
    if (addMoreRef.current) {
      setTimeout(() => {
        formRef.current?.reset();
        focusTextarea();
      }, 0);
    } else {
      props.onOpenChange(false);
    }
  }, [focusTextarea, props]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Submit feedback as a GitHub issue. Describe what you'd like to see
            changed or report a bug.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form
          ref={formRef}
          method="post"
          action="/api/feedback"
          className="space-y-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="url" value={location.pathname} />
          <div className="space-y-2">
            <Label htmlFor="feedback-description">Description</Label>
            <Textarea
              ref={textareaRef}
              id="feedback-description"
              name="description"
              placeholder="Describe your feedback in detail..."
              className="max-h-64 overflow-y-auto"
              rows={4}
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="feedback-add-more"
              checked={addMore}
              onCheckedChange={(checked) => {
                const value = checked === true;
                setAddMore(value);
                if (typeof localStorage !== "undefined") {
                  localStorage.setItem(ADD_MORE_STORAGE_KEY, String(value));
                }
              }}
            />
            <Label htmlFor="feedback-add-more" className="text-sm font-normal">
              Add more
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Submit</Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
