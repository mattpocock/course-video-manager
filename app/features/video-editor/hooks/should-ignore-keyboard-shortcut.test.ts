import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { shouldIgnoreKeyboardShortcut } from "./should-ignore-keyboard-shortcut";

function makeEvent(target: unknown): KeyboardEvent {
  const event = { target } as KeyboardEvent;
  return event;
}

class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}
class FakeHTMLButtonElement {
  classList = { contains: (_cls: string) => false };
}

describe("shouldIgnoreKeyboardShortcut", () => {
  const origInput = globalThis.HTMLInputElement;
  const origTextarea = globalThis.HTMLTextAreaElement;
  const origButton = globalThis.HTMLButtonElement;

  beforeAll(() => {
    (globalThis as any).HTMLInputElement = FakeHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = FakeHTMLTextAreaElement;
    (globalThis as any).HTMLButtonElement = FakeHTMLButtonElement;
  });

  afterAll(() => {
    (globalThis as any).HTMLInputElement = origInput;
    (globalThis as any).HTMLTextAreaElement = origTextarea;
    (globalThis as any).HTMLButtonElement = origButton;
  });

  it("allows shortcuts for a generic element outside a dialog", () => {
    const target = { closest: () => null };
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(false);
  });

  it("suppresses shortcuts when focused on an input", () => {
    const target = new FakeHTMLInputElement();
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("suppresses shortcuts when focused on a textarea", () => {
    const target = new FakeHTMLTextAreaElement();
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("suppresses shortcuts when focused on a button without allow-keydown", () => {
    const target = new FakeHTMLButtonElement();
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("allows shortcuts for a button with allow-keydown", () => {
    const target = new FakeHTMLButtonElement();
    target.classList.contains = (cls: string) => cls === "allow-keydown";
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(false);
  });

  it("suppresses shortcuts when typing in a contenteditable (Monaco's edit context)", () => {
    const target = { isContentEditable: true, closest: () => null };
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("suppresses shortcuts anywhere inside a Monaco editor", () => {
    const editorEl = {};
    const target = {
      closest: (sel: string) => (sel === ".monaco-editor" ? editorEl : null),
    };
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("suppresses shortcuts when focused inside a dialog", () => {
    const dialogEl = {};
    const target = {
      closest: (sel: string) => (sel === '[role="dialog"]' ? dialogEl : null),
    };
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(true);
  });

  it("allows shortcuts when not inside a dialog", () => {
    const target = { closest: () => null };
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(false);
  });

  it("allows shortcuts when target has no closest method", () => {
    const target = {};
    expect(shouldIgnoreKeyboardShortcut(makeEvent(target))).toBe(false);
  });
});
