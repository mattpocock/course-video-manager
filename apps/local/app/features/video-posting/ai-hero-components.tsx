"use client";

import { useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  UnplugIcon,
  XCircleIcon,
} from "lucide-react";

export function AiHeroConnectCard() {
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const revalidator = useRevalidator();

  const startDeviceFlow = async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/ai-hero/device-code", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start device flow");
        return;
      }
      setDeviceFlow({
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        deviceCode: data.deviceCode,
      });
      setPolling(true);
      try {
        const pollRes = await fetch("/api/auth/ai-hero/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: data.deviceCode }),
        });
        const pollData = await pollRes.json();
        if (pollRes.ok && pollData.success) {
          setDeviceFlow(null);
          revalidator.revalidate();
        } else {
          setError(pollData.error || "Authorization failed");
        }
      } finally {
        setPolling(false);
      }
    } catch {
      setError("Failed to connect to server");
    }
  };

  const copyUserCode = () => {
    if (deviceFlow) {
      navigator.clipboard.writeText(deviceFlow.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="max-w-md w-full">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-2">
          <XCircleIcon className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Connect AI Hero Account</CardTitle>
        </div>
        <CardDescription>
          Connect your AI Hero account to publish posts directly from this app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!deviceFlow ? (
          <div className="flex justify-center">
            <Button onClick={startDeviceFlow}>Connect to AI Hero</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter this code on AI Hero to connect your account:
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-4 py-2 rounded text-lg font-mono tracking-wider">
                {deviceFlow.userCode}
              </code>
              <Button variant="ghost" size="icon" onClick={copyUserCode}>
                {copied ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <a
                  href={deviceFlow.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open AI Hero Activation Page
                </a>
              </Button>
              {polling && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  Waiting for authorization...
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AiHeroConnectionStatus({ userId }: { userId: string }) {
  const disconnectFetcher = useFetcher();

  return (
    <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="h-4 w-4 text-green-500" />
        Connected as {userId}
      </div>
      <disconnectFetcher.Form
        method="post"
        action="/api/auth/ai-hero/disconnect"
      >
        <Button variant="ghost" size="sm" type="submit">
          <UnplugIcon className="size-3.5 mr-1" />
          Disconnect
        </Button>
      </disconnectFetcher.Form>
    </div>
  );
}
