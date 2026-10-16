import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useMatches,
  type ShouldRevalidateFunction,
} from "react-router";
import {
  AlertTriangle,
  CheckIcon,
  CopyIcon,
  Home,
  RefreshCw,
  ServerCrash,
} from "lucide-react";

import type { Route } from "./+types/root";
import { Toaster } from "@/components/ui/sonner";
import { toastsAllowed } from "@/lib/route-toasts";
import {
  captureEarlyClicksScript,
  replayEarlyClicks,
} from "@/lib/early-clicks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEffect, useState } from "react";
import { purgeLegacyDocumentStorage } from "@/features/article-writer/write-utils";
import { FeedbackModal } from "@/components/feedback-modal";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { slowRequestMiddleware } from "@/services/slow-request-log.server";
import { makeLoader } from "@/services/route-action.server";
import { readTldrawLicenseKey } from "@/features/diagrams/tldraw-license-key.server";
import type { RootLoaderData } from "@/features/diagrams/use-tldraw-license-key";
import { Effect } from "effect";
import "./app.css";

// Every request, page or resource route, is timed here, once.
export const middleware: Route.MiddlewareFunction[] = [slowRequestMiddleware];

// The tldraw licence key, for every tldraw component (useTldrawLicenseKey). It
// is meant to reach the browser; unset, tldraw shows its default watermark.
export const loader = makeLoader({
  effect: () =>
    Effect.map(readTldrawLicenseKey, (tldrawLicenseKey): RootLoaderData => ({
      tldrawLicenseKey,
    })),
});

// Nothing the root loader returns changes while the server runs, and the
// Diagram Playground revalidates every 2s: never re-run it.
export const shouldRevalidate: ShouldRevalidateFunction = () => false;

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Shantell+Sans:ital,wght@0,300..800;1,300..800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // A route opts out of toasts with `handle = NO_TOASTS` (see route-toasts).
  const showToasts = toastsAllowed(useMatches());
  // Hydration has committed, so every handler is attached: hand the clicks
  // that landed on the server-rendered page to them (lib/early-clicks.ts).
  // Layout, not App, so an error page gets its clicks back too.
  useEffect(replayEarlyClicks, []);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Buffers clicks that land before React hydrates; the effect above
            replays them (lib/early-clicks.ts). The client's copy of the
            source can differ from the server's (dev transforms), and only the
            server's runs. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: captureEarlyClicksScript }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        {showToasts && <Toaster />}
      </body>
    </html>
  );
}

export default function App() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  // Sweep up writer documents left behind by the retired localStorage
  // persistence, so no stale draft can resurface over a newer saved value.
  useEffect(purgeLegacyDocumentStorage, []);
  // The teleprompter window is pointed at a camera lens, so
  // no app chrome belongs on it.
  const isTeleprompter = useLocation().pathname.startsWith("/teleprompter");
  // The Shorts studio's Post button sits in the bottom-right corner, right
  // where the feedback button floats, so lift the button clear of it there.
  const isShort = useMatches().some(
    (m) =>
      (m.loaderData as { videoFormat?: unknown } | undefined)?.videoFormat ===
      "short"
  );

  return (
    <>
      <Outlet />
      {!isTeleprompter && (
        <Button
          size="icon"
          variant="outline"
          className={`fixed ${isShort ? "bottom-14" : "bottom-4"} z-40 rounded-full size-10 shadow-lg transition-[right] duration-200`}
          style={{
            right: "calc(1rem + var(--agent-sidebar-width, 0px))",
          }}
          onClick={() => setFeedbackOpen(true)}
          disabled={feedbackSubmitting}
          aria-label="Send feedback"
        >
          {feedbackSubmitting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <MessageSquarePlus className="size-5" />
          )}
        </Button>
      )}
      {!isTeleprompter && (
        <FeedbackModal
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          onSubmittingChange={setFeedbackSubmitting}
        />
      )}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const [isCopied, setIsCopied] = useState(false);
  let status = 500;
  let title = "Something went wrong";
  let description = "An unexpected error occurred. Please try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      description =
        "The page you're looking for doesn't exist or has been moved.";
    } else if (error.status === 500) {
      title = "Server error";
      description = "Something went wrong on our end. Please try again later.";
    } else {
      title = `Error ${error.status}`;
      description = error.statusText || description;
    }
  } else if (error && error instanceof Error) {
    description = error.message;
    if (import.meta.env.DEV) {
      stack = error.stack;
    }
  }

  const Icon = status === 404 ? AlertTriangle : ServerCrash;

  const copyErrorToClipboard = async () => {
    try {
      const errorDetails = [
        `Error ${status}: ${title}`,
        "",
        `Description: ${description}`,
      ];

      if (stack) {
        errorDetails.push("", "Stack trace:", stack);
      }

      await navigator.clipboard.writeText(errorDetails.join("\n"));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error to clipboard:", err);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <Icon className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="text-base">{description}</CardDescription>
        </CardHeader>
        {stack && (
          <CardContent>
            <div className="rounded-md bg-muted p-4 overflow-x-auto max-h-64 overflow-y-auto">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words">
                {stack}
              </pre>
            </div>
          </CardContent>
        )}
        <CardFooter className="flex justify-center gap-3">
          <Button variant="outline" onClick={copyErrorToClipboard}>
            {isCopied ? (
              <CheckIcon className="h-4 w-4 mr-2" />
            ) : (
              <CopyIcon className="h-4 w-4 mr-2" />
            )}
            {isCopied ? "Copied" : "Copy error"}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button onClick={() => (window.location.href = "/")}>
            <Home className="h-4 w-4 mr-2" />
            Go home
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
