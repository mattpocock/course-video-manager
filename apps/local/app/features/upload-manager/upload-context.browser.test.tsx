import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { JOB_STREAM_EVENTS } from "@/features/jobs/job-wire";
import {
  UploadContext,
  UploadProvider,
  useUploadActions,
} from "./upload-context";
import { delay } from "@/packages/clock";

/** Stands in for the tab's one `/api/jobs/events` stream. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Opening a page replays the tab's recent Job Events one by one, and each
 * one changes the Jobs state. A page that only starts Jobs (the Course view,
 * with every Lesson row under it) must not re-render for each: on a big
 * Course that froze the tab for seconds after hydration.
 */
describe("UploadProvider", () => {
  it("keeps the actions stable while Job Events stream in", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );

    let actionRenders = 0;
    let stateRenders = 0;
    function StartsJobs() {
      useUploadActions();
      actionRenders++;
      return null;
    }
    function WatchesJobs() {
      const { jobs } = useContext(UploadContext);
      stateRenders++;
      return <span>{jobs.sidecar}</span>;
    }

    render(
      <UploadProvider>
        <StartsJobs />
        <WatchesJobs />
      </UploadProvider>
    );
    const rendersAfterMount = actionRenders;
    const stateRendersAfterMount = stateRenders;

    for (let i = 0; i < 20; i++) {
      FakeEventSource.last!.emit(
        i % 2 === 0
          ? JOB_STREAM_EVENTS.sidecarUnavailable
          : JOB_STREAM_EVENTS.sidecarAvailable,
        { message: "down" }
      );
      await delay(0);
    }

    // The Jobs state did change, and its watchers heard it...
    expect(stateRenders).toBeGreaterThan(stateRendersAfterMount);
    // ...but a page that only starts Jobs never re-rendered.
    expect(actionRenders).toBe(rendersAfterMount);
  });
});
