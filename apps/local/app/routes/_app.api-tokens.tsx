import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiTokenOperationsService,
  type ApiTokenSummary,
} from "@/services/db-api-token-operations.server";
import { API_TOKEN_DEFAULT_EXPIRY_DAYS } from "@cvm/core/lib/api-token-constants";
import { makeAction, makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { Ban, Copy, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/_app.api-tokens";

export const meta: Route.MetaFunction = () => [{ title: "CVM - API Tokens" }];

const DAY_MS = 24 * 60 * 60 * 1000;

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const tokens = yield* ApiTokenOperationsService;
      return { tokens: yield* tokens.list() };
    }),
});

/**
 * Minting and revoking, in one action.
 *
 * Minting ANSWERS WITH THE SECRET, exactly once. Nothing stores it — not this
 * route, not the database, which holds only its SHA-256. If the author navigates
 * away before copying it, the token is unusable and the honest fix is to revoke
 * it and mint another.
 */
export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const tokens = yield* ApiTokenOperationsService;
      const form = payload as Record<string, string | undefined>;

      if (form.intent === "revoke") {
        yield* tokens.revoke(form.id ?? "");
        return { secret: null };
      }

      const days = Number(form.expiresInDays);
      const expiresInDays =
        Number.isFinite(days) && days > 0
          ? days
          : API_TOKEN_DEFAULT_EXPIRY_DAYS;

      const minted = yield* tokens.mint({
        name: (form.name ?? "").trim() || "unnamed box",
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
      });

      return { secret: minted.secret };
    }),
  errors: { NotFoundError: 404 },
});

const formatDate = (value: Date | string | null): string =>
  value === null ? "—" : new Date(value).toLocaleDateString();

type TokenRowProps = {
  readonly token: ApiTokenSummary;
  readonly onRevoke: (id: string) => void;
};

const statusOf = (token: ApiTokenSummary): string => {
  if (token.revokedAt !== null) return "revoked";
  if (new Date(token.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
};

function TokenRow({ token, onRevoke }: TokenRowProps) {
  const status = statusOf(token);

  return (
    <div className="flex items-center justify-between gap-4 p-4 border rounded-lg">
      <div className="min-w-0">
        <div className="font-medium truncate">{token.name}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {token.id}
        </div>
      </div>
      <div className="text-xs text-muted-foreground text-right shrink-0 space-y-0.5">
        <div>expires {formatDate(token.expiresAt)}</div>
        <div>last used {formatDate(token.lastUsedAt)}</div>
      </div>
      <div className="shrink-0 w-24 text-right">
        {status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRevoke(token.id)}
          >
            <Ban className="w-3.5 h-3.5" />
            Revoke
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{status}</span>
        )}
      </div>
    </div>
  );
}

export default function ApiTokens({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<{ secret: string | null }>();
  const [secret, setSecret] = useState<string | null>(null);

  // The secret exists in exactly one response. Hold it in component state so a
  // revalidation cannot quietly replace it with the list that does not have it.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.secret) {
      setSecret(fetcher.data.secret);
    }
  }, [fetcher.state, fetcher.data]);

  const revoke = (id: string) =>
    fetcher.submit({ intent: "revoke", id }, { method: "post" });

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">API Tokens</h1>
        <p className="text-muted-foreground mb-6">
          A token lets a machine that is not this one read and write your
          Courses through <code className="font-mono">cvm</code>. Put it on the
          box as <code className="font-mono">CVM_API_TOKEN</code>. A token
          grants everything the API exposes — there is no scoping — so revoke
          one the moment you stop trusting the machine it is on.
        </p>

        <fetcher.Form method="post" className="flex items-end gap-3 mb-8">
          <input type="hidden" name="intent" value="mint" />
          <div className="flex-1">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              name="name"
              placeholder="agent box"
              autoComplete="off"
            />
          </div>
          <div className="w-32">
            <Label htmlFor="token-expiry">Expires in (days)</Label>
            <Input
              id="token-expiry"
              name="expiresInDays"
              type="number"
              min={1}
              defaultValue={API_TOKEN_DEFAULT_EXPIRY_DAYS}
            />
          </div>
          <Button type="submit" disabled={fetcher.state !== "idle"}>
            <KeyRound className="w-4 h-4" />
            Mint
          </Button>
        </fetcher.Form>

        {secret !== null && (
          <div className="mb-8 p-4 border rounded-lg bg-muted/40">
            <div className="font-medium mb-1">
              Copy this now — it is shown once
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Only the hash is stored. Leave this page without copying and the
              token is unusable: revoke it and mint another.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs break-all p-2 rounded bg-background border">
                {secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(secret)}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </Button>
            </div>
          </div>
        )}

        {loaderData.tokens.length === 0 ? (
          <p className="text-muted-foreground">No tokens yet.</p>
        ) : (
          <div className="space-y-2">
            {loaderData.tokens.map((token) => (
              <TokenRow key={token.id} token={token} onRevoke={revoke} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
