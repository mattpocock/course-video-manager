export interface SSEClientConfig<
  TEvents extends Record<string, (data: any) => void>,
> {
  url: string;
  method?: "POST" | "GET";
  body?: unknown;
  events: TEvents;
  onError: (message: string) => void;
  errorLabel?: string;
}

export const consumeSSEStream = <
  TEvents extends Record<string, (data: any) => void>,
>(
  config: SSEClientConfig<TEvents>
): AbortController => {
  const abortController = new AbortController();

  performSSEStream(config, abortController.signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    config.onError(
      error instanceof Error
        ? error.message
        : (config.errorLabel ?? "Stream failed")
    );
  });

  return abortController;
};

const performSSEStream = async <
  TEvents extends Record<string, (data: any) => void>,
>(
  config: SSEClientConfig<TEvents>,
  signal: AbortSignal
): Promise<void> => {
  const response = await fetch(config.url, {
    method: config.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config.body ?? {}),
    signal,
  });

  if (!response.ok || !response.body) {
    config.onError(config.errorLabel ?? "Stream failed");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ") && eventType) {
        const eventData = JSON.parse(line.slice(6));
        const handler = config.events[eventType as keyof TEvents];
        if (handler) {
          handler(eventData);
        }
        eventType = "";
      }
    }
  }
};
