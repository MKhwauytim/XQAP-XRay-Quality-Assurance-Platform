/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DemoDebugPanel } from "./DemoDebugPanel";
import { getLabels } from "../../data/labels/labelsStore";
import * as demoDebugReport from "../../data/debug/demoDebugReport";
import { __resetResponsivenessMonitorForTests } from "../../data/debug/responsivenessMonitor";

afterEach(() => {
  cleanup();
  __resetResponsivenessMonitorForTests();
  vi.restoreAllMocks();
});

describe("DemoDebugPanel", () => {
  it("renders every section and the close button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<DemoDebugPanel onClose={onClose} />);

    const L = getLabels();
    expect(container.textContent).toContain(L.demo_debug_section_connection);
    expect(container.textContent).toContain(L.demo_debug_section_sync);
    expect(container.textContent).toContain(L.demo_debug_section_responsiveness);
    expect(container.textContent).toContain(L.demo_debug_section_memory);
    expect(container.textContent).toContain(L.demo_debug_section_errors);

    fireEvent.click(container.querySelector(".demo-debug-panel-close")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking export calls exportDemoDebugReport", async () => {
    const exportSpy = vi
      .spyOn(demoDebugReport, "exportDemoDebugReport")
      .mockResolvedValue({} as never);

    const { container } = render(<DemoDebugPanel onClose={() => {}} />);
    fireEvent.click(container.querySelector(".demo-debug-export-btn")!);

    await vi.waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
  });
});
