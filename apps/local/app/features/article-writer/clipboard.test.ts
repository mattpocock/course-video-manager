import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { copyToClipboard, pasteFromClipboard } from "./clipboard";
import { delay } from "@/packages/clock";

vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn() },
}));

const settle = () => delay(0);

describe("writer clipboard buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the copy done only once the text is on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onCopied = vi.fn();

    copyToClipboard("the doc", onCopied);
    await settle();

    expect(writeText).toHaveBeenCalledWith("the doc");
    expect(onCopied).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when the copy fails, instead of showing Copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onCopied = vi.fn();

    copyToClipboard("the doc", onCopied);
    await settle();

    expect(onCopied).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Failed to copy to clipboard");
  });

  it("pastes the clipboard's text, and ignores a blank one", async () => {
    const readText = vi
      .fn()
      .mockResolvedValueOnce("pasted")
      .mockResolvedValueOnce("  \n");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onText = vi.fn();

    pasteFromClipboard(onText);
    pasteFromClipboard(onText);
    await settle();

    expect(onText).toHaveBeenCalledExactlyOnceWith("pasted");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when the clipboard cannot be read, instead of doing nothing", async () => {
    const readText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onText = vi.fn();

    pasteFromClipboard(onText);
    await settle();

    expect(onText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to paste from the clipboard"
    );
  });
});
