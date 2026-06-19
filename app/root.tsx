import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import { UploadProvider } from "@/features/upload-manager/upload-context";
import { GlobalUploadProgress } from "@/features/upload-manager/global-upload-progress";
import { FeedbackModal } from "@/components/feedback-modal";
import { Loader2, MessageSquarePlus } from "lucide-react";
import "./app.css";

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
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        <Toaster />
      </body>
    </html>
  );
}

export default function App() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  return (
    <UploadProvider>
      <GlobalUploadProgress />
      <Outlet />
      <Button
        size="icon"
        variant="outline"
        className="fixed bottom-4 z-40 rounded-full size-10 shadow-lg transition-[right] duration-200"
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
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onSubmittingChange={setFeedbackSubmitting}
      />
    </UploadProvider>
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
