import { useCallback, useState } from "react";
import { useRevalidator } from "react-router";
import { postAction } from "@/lib/post-action";

export function useActionSubmit() {
  const { revalidate } = useRevalidator();
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (
      action: string,
      body: FormData | Record<string, string>
    ): Promise<unknown> => {
      setPending(true);
      try {
        const answer = await postAction(action, body);
        await revalidate();
        return answer;
      } finally {
        setPending(false);
      }
    },
    [revalidate]
  );

  return { submit, pending };
}
