import { describe, it, expect, vi } from "vitest";
import { yieldToMain } from "./yieldToMain";

describe("yieldToMain", () => {
  it("resolves via a real setTimeout(0), not a microtask", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let resolved = false;
    void yieldToMain().then(() => { resolved = true; });
    await Promise.resolve(); // flush microtasks -- must NOT have resolved yet
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
