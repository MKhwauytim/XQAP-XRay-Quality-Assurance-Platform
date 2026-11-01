/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import { MoveCasesButton } from "./MoveCasesButton";

afterEach(cleanup);

const entry = (id: string, status: "pending" | "completed", adhocImportId?: string): DistributionEntry =>
  ({ xrayImageId: id, assignedTo: "e", status, replacedById: null, lastEventAt: "", ...(adhocImportId ? { adhocImportId, adhocFileName: "f" } : {}) }) as unknown as DistributionEntry;

const ENTRIES = [entry("A", "pending"), entry("B", "completed"), entry("C", "pending", "adh-1")];

function mount(role: string, caseFilter: "all" | "risk-targeted" | "adhoc") {
  return render(
    <MoveCasesButton
      directoryHandle={createMemoryDirectory()}
      month="1-January-2026"
      caseFilter={caseFilter}
      entries={ENTRIES}
      isStudied={(e) => e.status === "completed"}
      username="admin"
      role={role}
      onDone={() => {}}
    />,
  );
}

describe("MoveCasesButton", () => {
  it("is admin-only and hidden on the «all» chip", () => {
    expect(mount("supervisor", "risk-targeted").container.textContent).toBe("");
    cleanup();
    expect(mount("admin", "all").container.textContent).toBe("");
  });

  it("counts only the unstudied cases of the shown bucket", () => {
    mount("admin", "risk-targeted");
    expect(screen.getByRole("button").textContent).toContain("(1)");
    expect(screen.getByRole("button").textContent).toContain("للاستثنائية");
    cleanup();
    mount("admin", "adhoc");
    expect(screen.getByRole("button").textContent).toContain("مستهدف المؤشر");
  });
});
