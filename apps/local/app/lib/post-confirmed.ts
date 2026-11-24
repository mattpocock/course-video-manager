import { postAction } from "./post-action";

const isConfirmed = (answer: unknown): boolean =>
  typeof answer === "object" &&
  answer !== null &&
  "ok" in answer &&
  answer.ok === true;

/**
 * `postAction`, resolving only once the action answered `{ ok: true }`; it
 * rejects otherwise, with the action's own error on a failure. For a save
 * that something irreversible waits on, such as removing local images after
 * an Apply: a `fetcher.submit` resolves whether the action succeeded or not.
 */
export async function postConfirmed(
  action: string,
  fields: Record<string, string>
): Promise<void> {
  const answer = await postAction(action, fields);
  if (!isConfirmed(answer)) {
    throw new Error("Save failed: the action did not confirm it");
  }
}
