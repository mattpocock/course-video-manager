import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type MouseEvent } from "react";
import { toast, toastError, toastOnReject, ToastText } from "./toast";

type SonnerToast = typeof import("sonner").toast;
type Show = SonnerToast["success"];

const sonnerToast = vi.hoisted(() =>
  Object.assign(vi.fn<SonnerToast>(), {
    success: vi.fn<Show>(),
    info: vi.fn<Show>(),
    warning: vi.fn<Show>(),
    error: vi.fn<Show>(),
    message: vi.fn<Show>(),
    loading: vi.fn<Show>(),
    promise: vi.fn<SonnerToast["promise"]>(),
    custom: vi.fn<SonnerToast["custom"]>(),
    dismiss: vi.fn<SonnerToast["dismiss"]>(),
    getHistory: vi.fn<SonnerToast["getHistory"]>(),
    getToasts: vi.fn<SonnerToast["getToasts"]>(),
  })
);

vi.mock("sonner", () => ({ toast: sonnerToast }));

interface Action {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

const lastErrorCall = () => {
  const call = vi.mocked(sonnerToast.error).mock.calls.at(-1)!;
  return { title: call[0], data: call[1] };
};

const textOf = (node: unknown) =>
  isValidElement<{ text: string }>(node) && node.type === ToastText
    ? node.props.text
    : undefined;

describe("toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a string title and description through the clamped ToastText", () => {
    toast.success("Saved", { description: "All good" });

    const [title, data] = vi.mocked(sonnerToast.success).mock.calls[0]!;
    expect(textOf(title)).toBe("Saved");
    expect(textOf(data?.description)).toBe("All good");
  });

  it("re-issues the same toast, expanded, when Show more is pressed", () => {
    toast.info("a long message");

    const [first, firstData] = vi.mocked(sonnerToast.info).mock.calls[0]!;
    const props = (
      first as { props: { expanded: boolean; onToggle: () => void } }
    ).props;
    expect(props.expanded).toBe(false);
    props.onToggle();

    const [second, secondData] = vi.mocked(sonnerToast.info).mock.calls[1]!;
    expect((second as { props: { expanded: boolean } }).props.expanded).toBe(
      true
    );
    expect(secondData?.id).toBe(firstData?.id);
  });

  it("gives an error toast a Copy action that copies its full text and keeps it open", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const huge = "x".repeat(5000);

    toast.error(huge, { description: "while rendering" });

    const action = lastErrorCall().data?.action as Action;
    expect(action.label).toBe("Copy");
    const preventDefault = vi.fn();
    action.onClick({
      preventDefault,
    } as unknown as MouseEvent<HTMLButtonElement>);
    expect(preventDefault).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(`${huge}\n\nwhile rendering`);
    await vi.waitFor(() =>
      expect(vi.mocked(sonnerToast.success)).toHaveBeenCalled()
    );
    vi.unstubAllGlobals();
  });

  it("keeps a caller's own error action instead of adding Copy", () => {
    const own = { label: "Retry", onClick: vi.fn() };

    toast.error("Upload failed", { action: own });

    expect(lastErrorCall().data?.action).toBe(own);
  });
});

describe("toastError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an Error's message", () => {
    toastError(new Error("boom"), "Failed");
    expect(textOf(lastErrorCall().title)).toBe("boom");
  });

  it("falls back when the thrown value has no message", () => {
    toastError({ weird: true }, "Failed to upload images");
    expect(textOf(lastErrorCall().title)).toBe("Failed to upload images");
  });
});

describe("toastOnReject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the rejection's message", async () => {
    toastOnReject(Promise.reject(new Error("Course name taken")), "Failed");
    await vi.waitFor(() =>
      expect(textOf(lastErrorCall().title)).toBe("Course name taken")
    );
  });

  it("falls back when the rejection has no message", async () => {
    toastOnReject(Promise.reject(new Error("")), "Failed to rename the course");
    await vi.waitFor(() =>
      expect(textOf(lastErrorCall().title)).toBe("Failed to rename the course")
    );
  });

  it("shows nothing when the promise resolves", async () => {
    toastOnReject(Promise.resolve("done"), "Failed");
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(sonnerToast.error)).not.toHaveBeenCalled();
  });
});
