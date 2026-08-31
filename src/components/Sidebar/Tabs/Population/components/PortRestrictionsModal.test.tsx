/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import PortRestrictionsModal from "./PortRestrictionsModal";

afterEach(() => cleanup());

const CATALOG: PortCatalogCategory[] = [
  {
    category: "بحري",
    ports: [
      { portName: "ميناء جدة", rowCount: 10 },
      { portName: "ميناء الدمام", rowCount: 5 },
    ],
  },
  {
    category: "بري",
    ports: [{ portName: "منفذ الحديثة", rowCount: 3 }],
  },
];

const EMPLOYEE = { username: "f.otaibi", displayName: "فهد العتيبي" };

describe("PortRestrictionsModal", () => {
  it("shows an unrestricted employee with every port checked", () => {
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={undefined}
        onSave={() => {}}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/غير مقيّد/)).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeChecked();
    }
  });

  it("shows a restricted employee's saved ports pre-checked and the rest unchecked", () => {
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={{ username: "f.otaibi", restricted: true, enabledPorts: ["ميناء جدة"] }}
        onSave={() => {}}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/مقيّد — مفعّل في 1 من 3/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ميناء جدة" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ميناء الدمام" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "منفذ الحديثة" })).not.toBeChecked();
  });

  it("unchecking one port switches an unrestricted employee to restricted and saves the explicit list", () => {
    const onSave = vi.fn();
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={undefined}
        onSave={onSave}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "ميناء الدمام" }));
    expect(screen.getByText(/مقيّد — مفعّل في 2 من 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ القيود" }));

    expect(onSave).toHaveBeenCalledWith({
      username: "f.otaibi",
      restricted: true,
      enabledPorts: expect.arrayContaining(["ميناء جدة", "منفذ الحديثة"]),
    });
    const saved = onSave.mock.calls[0][0];
    expect(saved.enabledPorts).toHaveLength(2);
  });

  it("the category checkbox toggles every port under it at once", () => {
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={undefined}
        onSave={() => {}}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "بحري" }));

    expect(screen.getByRole("checkbox", { name: "ميناء جدة" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ميناء الدمام" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "منفذ الحديثة" })).toBeChecked();
  });

  it("clearing the restriction reverts to the unrestricted status and every port checked", () => {
    const onSave = vi.fn();
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={{ username: "f.otaibi", restricted: true, enabledPorts: ["ميناء جدة"] }}
        onSave={onSave}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "إزالة كل القيود" }));
    expect(screen.getByText(/غير مقيّد/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ القيود" }));
    expect(onSave).toHaveBeenCalledWith({
      username: "f.otaibi",
      restricted: false,
      enabledPorts: [],
    });
  });

  it("cancel closes without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <PortRestrictionsModal
        employee={EMPLOYEE}
        portCatalog={CATALOG}
        restriction={undefined}
        onSave={onSave}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "ميناء جدة" }));
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
