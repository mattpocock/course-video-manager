/**
 * A stand-in for the browser's `EventSource`, for browser tests that drive a
 * server-sent stream by hand. Stub it in with
 * `vi.stubGlobal("EventSource", FakeEventSource)`, then find the stream a
 * component opened by its URL and `emit` on it.
 */
export class FakeEventSource {
  /** Every stream opened since the last `reset`, by URL. */
  static readonly opened = new Map<string, FakeEventSource>();

  static reset() {
    FakeEventSource.opened.clear();
  }

  /** The stream opened at `url`. Throws if nothing opened it. */
  static at(url: string): FakeEventSource {
    const source = FakeEventSource.opened.get(url);
    if (!source) throw new Error(`No EventSource opened at ${url}`);
    return source;
  }

  private listeners = new Map<string, ((e: { data: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.opened.set(url, this);
  }

  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** The server sends `data`, as JSON, as an event named `type`. */
  emit(type: string, data: unknown) {
    this.listeners
      .get(type)
      ?.forEach((listener) => listener({ data: JSON.stringify(data) }));
  }

  close() {}
}
