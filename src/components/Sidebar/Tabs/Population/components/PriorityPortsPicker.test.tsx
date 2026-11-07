/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import { DEFAULT_LABELS as L } from "../../../../../data/labels/labelsStore";

const known = vi.hoisted(() => vi.fn());
vi.mock("../../../../../data/population/knownPorts", () => ({ loadKnownPorts: known }));

import MappingSettingsModal from "./MappingSettingsModal";

afterEach(() => cleanup());

describe("MappingSettingsModal — priority ports and known ports", () => {
  it("lists ports from earlier months before any file is uploaded, and saves priorityPorts", async () => {
    known.mockResolvedValueOnce([{ portName: "ميناء جدة", portType: "بحري", rowCount: 40 }]);
    const onConfigChange = vi.fn();
    render(
      <MappingSettingsModal
        isOpen
        mode="processing"
        onClose={vi.fn()}
        config={DEFAULT_POPULATION_CONFIG}
        onConfigChange={onConfigChange}
        canEditCertScanPorts
        directoryHandle={{} as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.p2_priority_ports_open.replace("{count}", "0") }));
    const picker = screen.getByRole("dialog", { name: L.p2_priority_ports_title });
    fireEvent.click(await within(picker).findByRole("checkbox", { name: "ميناء جدة" }));
    fireEvent.click(within(picker).getByRole("button", { name: L.p2_certscan_ports_save }));

    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ priorityPorts: ["ميناء جدة"] }));
    expect(known).toHaveBeenCalledTimes(1);
  });

  it("the CertScan-ports picker also lists ports known from earlier months", async () => {
    known.mockResolvedValueOnce([{ portName: "منفذ الحديثة", portType: "بري", rowCount: 9 }]);
    render(
      <MappingSettingsModal
        isOpen
        mode="processing"
        onClose={vi.fn()}
        config={DEFAULT_POPULATION_CONFIG}
        onConfigChange={vi.fn()}
        canEditCertScanPorts
        directoryHandle={{} as never}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: L.p2_certscan_ports_open.replace("{count}", "0") }));
    const picker = screen.getByRole("dialog", { name: L.p2_certscan_ports_title });
    expect(await within(picker).findByRole("checkbox", { name: "منفذ الحديثة" })).toBeTruthy();
  });
});
