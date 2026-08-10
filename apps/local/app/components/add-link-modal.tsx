import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

export function AddLinkModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const titleFetcher = useFetcher<{ title: string | null }>();
  const [urlError, setUrlError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const isFetchingTitle = titleFetcher.state !== "idle";

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Please enter a valid URL (e.g., https://example.com)");
      return false;
    }
  };

  useEffect(() => {
    if (
      titleFetcher.state === "idle" &&
      titleFetcher.data?.title &&
      titleInputRef.current &&
      !titleInputRef.current.value
    ) {
      titleInputRef.current.value = titleFetcher.data.title;
    }
  }, [titleFetcher.state, titleFetcher.data]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Link</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action="/api/links"
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const url = formData.get("url") as string;

            if (!validateUrl(url)) {
              return;
            }

            await fetcher.submit(e.currentTarget);
            props.onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              name="url"
              type="url"
              placeholder="https://example.com"
              required
              autoFocus
              onChange={(e) => {
                if (urlError && e.target.value) {
                  validateUrl(e.target.value);
                }
              }}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData("text");
                try {
                  new URL(pastedText);
                  setUrlError(null);
                  titleFetcher.submit(
                    { url: pastedText },
                    { method: "post", action: "/api/links/fetch-title" }
                  );
                } catch {
                  // Not a valid URL, skip fetching title
                }
              }}
            />
            {urlError && <p className="text-sm text-red-500">{urlError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-title">Title</Label>
            <div className="relative">
              <Input
                ref={titleInputRef}
                id="link-title"
                name="title"
                placeholder="My Link"
                required
              />
              {isFetchingTitle && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-description">Description (optional)</Label>
            <Input
              id="link-description"
              name="description"
              placeholder="A brief description of this link"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state === "submitting"}>
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Add Link"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
