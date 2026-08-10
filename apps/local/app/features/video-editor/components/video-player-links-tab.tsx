import { Button } from "@/components/ui/button";
import { AddLinkModal } from "@/components/add-link-modal";
import { LinkIcon, ExternalLinkIcon, Trash2Icon, PlusIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useState, useEffect } from "react";

/**
 * Links tab content for the video player panel.
 * Manages fetching, displaying, adding, and deleting global links.
 */
export const VideoPlayerLinksTab = () => {
  const linksFetcher = useFetcher<{
    links: {
      id: string;
      title: string;
      url: string;
      description?: string | null;
    }[];
  }>();
  const deleteLinkFetcher = useFetcher();
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  // Load links when the component mounts
  useEffect(() => {
    if (linksFetcher.state === "idle" && !linksFetcher.data) {
      linksFetcher.load("/api/links");
    }
  }, [linksFetcher]);

  const links = linksFetcher.data?.links ?? [];

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2 py-1 px-2">
          <LinkIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm flex-1">Links</span>
          <span className="text-xs text-muted-foreground">
            ({links.length})
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsAddLinkModalOpen(true)}
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </div>
        {links.length > 0 ? (
          <div className="space-y-1 px-2">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-start gap-2 py-1 px-2 rounded hover:bg-muted/50 group text-sm"
              >
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 flex-1 min-w-0"
                >
                  <ExternalLinkIcon className="h-3 w-3 mt-1 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{link.title}</div>
                    {link.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {link.description}
                      </div>
                    )}
                  </div>
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 flex-shrink-0"
                  onClick={() => {
                    deleteLinkFetcher.submit(null, {
                      method: "post",
                      action: `/api/links/${link.id}/delete`,
                    });
                    linksFetcher.load("/api/links");
                  }}
                >
                  <Trash2Icon className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-2 text-sm text-muted-foreground">
            No links yet
          </div>
        )}
      </div>

      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={(open) => {
          setIsAddLinkModalOpen(open);
          if (!open) {
            linksFetcher.load("/api/links");
          }
        }}
      />
    </>
  );
};
