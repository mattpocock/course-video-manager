/**
 * A fenced block on the glass: a command to run or a file's contents to paste,
 * set exactly as written and copied out in one click.
 *
 * Not the app's kibo `CodeBlock`: that one brings shiki and a panel's chrome,
 * and the glass wants neither — just the text, unwrapped from markdown, and a
 * button big enough to hit from where you stand.
 */
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { TYPE } from "./teleprompter-settings";
import { after } from "@/packages/clock";

const COPIED_FOR_MS = 2000;

export function ScriptCodeBlock(props: {
  code: string;
  /**
   * Set at the size of what surrounds it, inside an `<instructions>` region that has
   * already stepped the type down. Standing alone in the spoken script, it
   * steps down itself — a command is copied, never read aloud.
   */
  nested: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      data-code-block
      className="group relative rounded-md border border-white/15 bg-white/5"
      style={{ fontSize: props.nested ? "1em" : `${TYPE.instructionsScale}em` }}
    >
      <pre
        className="m-0 py-3 pl-4 pr-14 font-mono"
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          lineHeight: 1.45,
          color: TYPE.color,
        }}
      >
        {props.code}
      </pre>
      <button
        type="button"
        aria-label="Copy to clipboard"
        className="absolute right-2 top-2 rounded p-2 text-neutral-400 hover:bg-white/10 hover:text-white"
        onClick={(e) => {
          // Off the button at once: the teleprompter's keys listen on the
          // window, and a focused button would take Space as a second click.
          e.currentTarget.blur();
          void navigator.clipboard.writeText(props.code).then(() => {
            setCopied(true);
            after(COPIED_FOR_MS, () => setCopied(false));
          });
        }}
      >
        {copied ? (
          <CheckIcon className="size-5" />
        ) : (
          <CopyIcon className="size-5" />
        )}
      </button>
    </div>
  );
}
