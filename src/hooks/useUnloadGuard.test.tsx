/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { useUnloadGuard } from "./useUnloadGuard";

function Harness({ enabled }: { enabled: boolean }) {
  useUnloadGuard(enabled);
  return null;
}

/** Dispatch a real `beforeunload` and report whether a listener objected. */
function fireBeforeUnload(): { prevented: boolean; returnValue: unknown } {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return { prevented: event.defaultPrevented, returnValue: event.returnValue };
}

// `globals: false` means React Testing Library never registers its own
// auto-cleanup, so a mounted Harness would keep its beforeunload listener
// installed for every later test in this file — and this suite asserts on
// exactly that listener.
afterEach(() => {
  cleanup();
});

describe("useUnloadGuard", () => {
  it("does not object while there is nothing to lose", () => {
    render(<Harness enabled={false} />);
    expect(fireBeforeUnload().prevented).toBe(false);
  });

  it("objects while there is unsaved work", () => {
    render(<Harness enabled />);
    const { prevented, returnValue } = fireBeforeUnload();
    expect(prevented).toBe(true);
    // The legacy channel only has to be SET; the text is the browser's, not
    // ours — see the hook's own doc.
    expect(returnValue).toBeDefined();
  });

  it("stops objecting once the work is saved", () => {
    const view = render(<Harness enabled />);
    expect(fireBeforeUnload().prevented).toBe(true);

    view.rerender(<Harness enabled={false} />);
    expect(fireBeforeUnload().prevented).toBe(false);
  });

  it("removes its listener on unmount", () => {
    // A `beforeunload` listener left installed disqualifies the page from the
    // back/forward cache for the rest of the session, which is why this hook
    // adds one only while it is needed.
    const view = render(<Harness enabled />);
    view.unmount();
    expect(fireBeforeUnload().prevented).toBe(false);
  });
});
