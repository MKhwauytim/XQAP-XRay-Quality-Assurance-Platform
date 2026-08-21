/* @vitest-environment jsdom */
// AssignmentPanel is the ad-hoc import's distribution control. The property that
// matters most here is that the LIVE PREVIEW is produced by the same
// `planAdhocAssignment` the write path runs, so the number the admin reads is the
// number that gets written — each mode below asserts the preview total against
// what the planner is contractually required to produce. Fan-out is additionally
// gated behind an explicit confirmation because it is the one mode that
// multiplies workload.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { createManagedUser, type ManagedLoginUser } from "../../../../auth/userManagement";
import type { PasswordHashRecord } from "../../../../auth/passwordCrypto";
import { DEFAULT_LABELS as L } from "../../../../data/labels/labelsStore";
import type { AdhocRow, AssignmentPlan } from "../../../../data/adhocImport/adhocImportModel";
import AssignmentPanel from "./AssignmentPanel";

afterEach(cleanup);

/** Shape-only stand-in: nothing here verifies a password, the panel only reads the roster. */
const HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$AAAA$AAAA",
};

function employee(username: string): ManagedLoginUser {
  return createManagedUser({
    username,
    displayName: username,
    role: "employee",
    passwordHash: HASH,
    isActive: true,
  });
}

const EMPLOYEES = [employee("emp-a"), employee("emp-b")];

function row(index: number): AdhocRow {
  return {
    rowKey: `s1:${index}`,
    mapped: { xrayImageId: `XR-${index}` },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

/** Six eligible rows: divisible by two, so the percentage split has no remainder to argue about. */
const ROWS = [row(2), row(3), row(4), row(5), row(6), row(7)];

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof AssignmentPanel>> = {}
): { onAssign: ReturnType<typeof vi.fn> } {
  const onAssign = vi.fn<(plan: AssignmentPlan) => void>();
  render(
    <AssignmentPanel
      importId="adh-test"
      rows={ROWS}
      employees={EMPLOYEES}
      explicitRowKeys={[]}
      canAssign
      onAssign={onAssign}
      {...overrides}
    />
  );
  return { onAssign };
}

function chooseMode(label: string): void {
  fireEvent.click(screen.getByLabelText(label));
}

function total(count: number): string {
  return L.adhoc_assign_preview_total.replace("{count}", String(count));
}

describe("AssignmentPanel — live preview per mode", () => {
  it("explicit mode previews exactly the ticked rows for the chosen employee", () => {
    renderPanel({ explicitRowKeys: ["s1:2", "s1:3"] });

    fireEvent.change(screen.getByLabelText(L.adhoc_import_assign_to_label), {
      target: { value: "emp-a" },
    });

    expect(screen.getByText(total(2))).toBeInTheDocument();
    expect(
      screen.getByText(
        L.adhoc_assign_preview_per_employee.replace("{employee}", "emp-a").replace("{count}", "2")
      )
    ).toBeInTheDocument();
    // Four of the six eligible rows were not ticked — reported, never hidden.
    expect(
      screen.getByText(L.adhoc_assign_preview_leftover.replace("{count}", "4"))
    ).toBeInTheDocument();
  });

  it("count mode previews the sum of the per-employee counts", () => {
    renderPanel();
    chooseMode(L.adhoc_assign_mode_count);

    for (const name of ["emp-a", "emp-b"]) {
      fireEvent.click(
        screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", name))
      );
    }
    fireEvent.change(
      screen.getByLabelText(L.adhoc_assign_count_aria.replace("{employee}", "emp-a")),
      { target: { value: "2" } }
    );
    fireEvent.change(
      screen.getByLabelText(L.adhoc_assign_count_aria.replace("{employee}", "emp-b")),
      { target: { value: "3" } }
    );

    expect(screen.getByText(total(5))).toBeInTheDocument();
    expect(
      screen.getByText(L.adhoc_assign_preview_leftover.replace("{count}", "1"))
    ).toBeInTheDocument();
  });

  it("percentage mode splits the whole pool evenly when no weights are typed", () => {
    renderPanel();
    chooseMode(L.adhoc_assign_mode_percentage);

    for (const name of ["emp-a", "emp-b"]) {
      fireEvent.click(
        screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", name))
      );
    }

    // Hamilton always distributes every seat, so six rows over two equal weights
    // is three each and nothing left over.
    expect(screen.getByText(total(6))).toBeInTheDocument();
    expect(
      screen.getByText(
        L.adhoc_assign_preview_per_employee.replace("{employee}", "emp-a").replace("{count}", "3")
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(L.adhoc_assign_preview_leftover.replace("{count}", "0"))).toBeNull();
  });

  it("fan-out mode previews one assignment per row per employee", () => {
    renderPanel();
    chooseMode(L.adhoc_assign_mode_fanout);

    for (const name of ["emp-a", "emp-b"]) {
      fireEvent.click(
        screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", name))
      );
    }

    expect(screen.getByText(total(12))).toBeInTheDocument();
    expect(screen.getByText(L.adhoc_assign_preview_rows.replace("{count}", "6"))).toBeInTheDocument();
    expect(screen.getByText(L.adhoc_assign_fanout_warning)).toBeInTheDocument();
  });
});

describe("AssignmentPanel — fan-out confirmation", () => {
  it("asks for confirmation naming the total before writing, and writes only after confirming", () => {
    const { onAssign } = renderPanel();
    chooseMode(L.adhoc_assign_mode_fanout);
    for (const name of ["emp-a", "emp-b"]) {
      fireEvent.click(
        screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", name))
      );
    }

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_assign_submit }));

    expect(onAssign).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("12");

    fireEvent.click(screen.getByRole("button", { name: L.confirm_dialog_default_ok }));

    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0][0].plan).toHaveLength(12);
  });

  it("cancelling the fan-out confirmation writes nothing", () => {
    const { onAssign } = renderPanel();
    chooseMode(L.adhoc_assign_mode_fanout);
    fireEvent.click(
      screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", "emp-a"))
    );

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_assign_submit }));
    fireEvent.click(screen.getByRole("button", { name: L.confirm_dialog_default_cancel }));

    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes immediately for a non-fan-out mode", () => {
    const { onAssign } = renderPanel({ explicitRowKeys: ["s1:2"] });
    fireEvent.change(screen.getByLabelText(L.adhoc_import_assign_to_label), {
      target: { value: "emp-a" },
    });

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_assign_submit }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0][0].plan).toHaveLength(1);
  });
});

describe("AssignmentPanel — gating", () => {
  it("hides the submit button and disables the controls without the assign capability", () => {
    renderPanel({ canAssign: false });

    expect(screen.queryByRole("button", { name: L.adhoc_assign_submit })).toBeNull();
    expect(screen.getByLabelText(L.adhoc_import_assign_to_label)).toBeDisabled();
    expect(screen.getByLabelText(L.adhoc_assign_mode_fanout)).toBeDisabled();
  });

  it("disables the submit button while the import is closed", () => {
    renderPanel({ explicitRowKeys: ["s1:2"], disabled: true });

    expect(screen.getByRole("button", { name: L.adhoc_assign_submit })).toBeDisabled();
  });

  it("reports the planner's own complaints rather than reducing them to a total", () => {
    renderPanel();
    chooseMode(L.adhoc_assign_mode_count);
    fireEvent.click(
      screen.getByLabelText(L.adhoc_assign_employee_toggle_aria.replace("{employee}", "emp-a"))
    );
    fireEvent.change(
      screen.getByLabelText(L.adhoc_assign_count_aria.replace("{employee}", "emp-a")),
      { target: { value: "99" } }
    );

    expect(screen.getByText(L.adhoc_assign_errors_title)).toBeInTheDocument();
    // The shortfall names both the request and what could actually be placed.
    expect(screen.getByText(/99/)).toBeInTheDocument();
  });
});
