import { userEvent } from "@vitest/browser/context";
import { act, useEffect, useState } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { captureEarlyClicks, replayEarlyClicks } from "./early-clicks";
import { delay } from "@/packages/clock";

/**
 * The bug: the server-rendered page paints its buttons before React attaches
 * a listener, and a click in that window reached no handler at all. This
 * reproduces the window for real — server HTML in the document, a real click
 * on it, and only then `hydrateRoot` — with the replay where root.tsx puts
 * it: an effect that runs once hydration has committed.
 */
function Page(props: { onClick: () => void; onPointerDown: () => void }) {
  useEffect(replayEarlyClicks, []);
  return (
    <div>
      <button
        type="button"
        onClick={props.onClick}
        onPointerDown={props.onPointerDown}
      >
        Send feedback
      </button>
    </div>
  );
}

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  document.body.innerHTML = "";
});

it("hands a click that landed before hydration to the hydrated handler, once", async () => {
  const onClick = vi.fn();
  const onPointerDown = vi.fn();
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Page onClick={() => {}} onPointerDown={() => {}} />
  );
  document.body.append(container);

  captureEarlyClicks();
  const feedback = container.querySelector("button")!;
  await userEvent.click(feedback);
  expect(onClick).not.toHaveBeenCalled();

  await act(async () => {
    root = hydrateRoot(
      container,
      <Page onClick={onClick} onPointerDown={onPointerDown} />
    );
  });

  await expect.poll(() => onClick.mock.calls.length).toBe(1);
  // A Radix menu trigger opens on pointerdown, not click.
  expect(onPointerDown).toHaveBeenCalledTimes(1);

  // Hydrated: clicks now go straight to React, and are not replayed again.
  await userEvent.click(feedback);
  expect(onClick).toHaveBeenCalledTimes(2);
});

/** A Post button that disables itself while its post is in flight. */
function PostPage(props: { onPost: () => void }) {
  useEffect(replayEarlyClicks, []);
  const [posting, setPosting] = useState(false);
  return (
    <button
      type="button"
      disabled={posting}
      onClick={() => {
        setPosting(true);
        props.onPost();
      }}
    >
      Post
    </button>
  );
}

it("posts once when the dead-looking page was clicked twice before hydration", async () => {
  const onPost = vi.fn();
  const container = document.createElement("div");
  container.innerHTML = renderToString(<PostPage onPost={() => {}} />);
  document.body.append(container);

  captureEarlyClicks();
  const post = container.querySelector("button")!;
  await userEvent.click(post);
  await userEvent.click(post);

  await act(async () => {
    root = hydrateRoot(container, <PostPage onPost={onPost} />);
  });

  await expect.poll(() => onPost.mock.calls.length).toBe(1);
  // Replayed back to back in one task, the second click would get past the
  // disabled guard before React re-renders: two posts (2 before the fix).
  await delay(50);
  expect(onPost).toHaveBeenCalledTimes(1);
});
