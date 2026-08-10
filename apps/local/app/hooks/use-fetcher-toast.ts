import type { useFetcher } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";

type FetcherWithData = ReturnType<typeof useFetcher>;

interface UseFetcherToastOptions {
  successMessage?: string;
  errorMessage?: string;
}

/**
 * Shows toast notifications based on fetcher response.
 * - Success: shown when response is empty object {}
 * - Error: extracts message from JSON response or falls back to text
 */
export function useFetcherToast(
  fetcher: FetcherWithData,
  options: UseFetcherToastOptions = {}
) {
  const { successMessage = "Success", errorMessage = "An error occurred" } =
    options;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }

    const response = fetcher.data;

    if (response instanceof Response) {
      response
        .clone()
        .json()
        .then((json: { message?: string }) => {
          toast.error(json.message || errorMessage);
        })
        .catch(() => {
          response
            .clone()
            .text()
            .then((text: string) => {
              toast.error(text || errorMessage);
            });
        });
    } else if (
      typeof response === "object" &&
      Object.keys(response).length === 0
    ) {
      toast.success(successMessage);
    }
  }, [fetcher.state, fetcher.data, successMessage, errorMessage]);
}
