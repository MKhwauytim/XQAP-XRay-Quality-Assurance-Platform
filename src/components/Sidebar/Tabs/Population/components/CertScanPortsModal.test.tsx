/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import CertScanPortsModal from "./CertScanPortsModal";
import MappingSettingsModal from "./MappingSettingsModal";

afterEach(() => cleanup());

const CATALOG: PortCatalogCategory[] = [
  {
    category: "بحري",
    ports: [
      { portName: "ميناء جدة", rowCount: 10 },
      { portName: "ميناء الدمام", rowCount: 5 },
    ],
  },
  { category: "بري", ports: [{ portName: "منفذ الحديثة", rowCount: 3 }] },
];

describe("CertScanPortsModal (C2)", () => {
  it("pre-checks the flagged ports and saves the new selection in catalog order", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["منفذ الحديثة"]} onSave={onSave} onClose={() => {}} />);

    expect(screen.getByRole("checkbox", { name: "منفذ الحديثة" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ميناء جدة" })).not.toBeChecked();
    expect(screen.getByText("1 من 3 منفذ محدَّد كـ CertScan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "ميناء جدة" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith(["ميناء جدة", "منفذ الحديثة"]);
  });

  it("keeps a flagged port that is missing from this month's catalog", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["منفذ قديم"]} onSave={onSave} onClose={() => {}} />);

    expect(screen.getByText("محددة سابقاً — غير موجودة في ملف هذا الشهر")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "منفذ قديم" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith(["منفذ قديم"]);
  });

  it("clears every flag", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["ميناء جدة", "منفذ الحديثة"]} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء تحديد الكل" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith([]);
  });
});

describe("MappingSettingsModal — CertScan port picker wiring (C2)", () => {
  it("opens the picker from processing settings and saves certScanPorts through onConfigChange", () => {
    const onConfigChange = vi.fn();
    render(
      <MappingSettingsModal
        isOpen
        mode="processing"
        onClose={vi.fn()}
        config={{ ...DEFAULT_POPULATION_CONFIG, certScanPorts: ["منفذ ب"] }}
        onConfigChange={onConfigChange}
        canEditCertScanPorts
        certScanPortRows={[
          { portName: "منفذ أ", portType: "بري" },
          { portName: "منفذ ب", portType: "بري" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "تحديد المنافذ (1 محدد)" }));
    const picker = screen.getByRole("dialog", { name: "منافذ CertScan الكاملة" });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "منفذ أ" }));
    fireEvent.click(within(picker).getByRole("button", { name: "حفظ" }));

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ certScanPorts: ["منفذ أ", "منفذ ب"] }),
    );
  });

  it("hides the picker entirely without edit permission", () => {
    render(
      <MappingSettingsModal
        isOpen
        mode="processing"
        onClose={vi.fn()}
        config={DEFAULT_POPULATION_CONFIG}
        onConfigChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /تحديد المنافذ/ })).toBeNull();
  });
});
