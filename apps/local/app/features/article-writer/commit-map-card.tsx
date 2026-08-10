"use client";

import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The preview's stand-in for a commit map on aihero.dev.
 *
 * Deliberately static: the site's card carries a Copy dropdown offering
 * `pnpm reset <slug>` and `pnpm cherry-pick <slug>`, and this one shows those
 * commands as plain text. The author is proofreading the map, not resetting a
 * repo — and the CVM has no repo to reset.
 */
export function CommitMapCard({
  children,
  problems,
}: {
  children: ReactNode;
  problems: string[];
}) {
  return (
    <div className="my-6 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Commits
      </div>
      {children}
      <CardProblems problems={problems} />
    </div>
  );
}

/**
 * One commit map entry.
 *
 * `main` is the one id that is not a slug: it names the course repo's starting
 * point, the state a student clones. The site disables cherry-pick for it,
 * because there is nothing to cherry-pick onto a branch that is already there.
 */
export function CommitEntryCard({
  id,
  description,
  problems,
}: {
  id: string | null;
  description: ReactNode;
  problems: string[];
}) {
  return (
    <div className="relative rounded-md border border-border bg-background p-3">
      <div className="font-mono text-sm font-semibold">
        {id ?? <span className="text-destructive">(no id)</span>}
      </div>

      <div className="mt-1 text-sm text-muted-foreground [&_p]:my-0">
        {typeof description === "string" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {description}
          </ReactMarkdown>
        ) : (
          description
        )}
      </div>

      {id ? (
        <div className="mt-2 space-y-0.5 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground/70">
          <div>pnpm reset {id}</div>
          {id === "main" ? null : <div>pnpm cherry-pick {id}</div>}
        </div>
      ) : null}

      <CardProblems problems={problems} />
    </div>
  );
}

function CardProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1 rounded-sm bg-destructive/10 p-2 text-xs text-destructive">
      {problems.map((problem) => (
        <li key={problem} className="flex items-start gap-1.5">
          <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
          <span>{problem}</span>
        </li>
      ))}
    </ul>
  );
}
