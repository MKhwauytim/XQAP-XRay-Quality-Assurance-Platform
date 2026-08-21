/* @vitest-environment jsdom */
// The load-bearing behaviour of this panel is what it does NOT do: a source
// value `seedValueMapping` could not match confidently must stay visibly
// undecided rather than being pre-selected onto `options[0]`. That absence is
// the difference between "the admin has not chosen yet" and "a wrong L1 result
// is now in a report", so it gets the most coverage here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import type {
  AdhocField,
  SourceRow,
  ValueMapping,
} from "../../../../data/adhocImport/adhocImportModel";
import ValueMappingPanel from "./ValueMappingPanel";

afterEach(cleanup);

const RESULT_FIELD: AdhocField = {
  key: "xrayLevelOneResult",
  labelAr: "نتيجة المستوى الأول",
  required: false,
  kind: "enum",
  options: ["سليمة", "اشتباه"],
  seedAliases: ["نتيجة المستوى الأول"],
};

const HEADER = "النتيجة";

function row(sourceRowNumber: number, value: string): SourceRow {
  return { sourceRowNumber, values: { [HEADER]: value } };
}

/** "سليم" seeds by folded containment; "قيد المراجعة" matches nothing. */
const ROWS: SourceRow[] = [row(2, "سليم"), row(3, "قيد المراجعة"), row(4, "سليم")];

describe("ValueMappingPanel", () => {
  it("renders a value with no seeded entry as unresolved", () => {
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={ROWS}
        header={HEADER}
        valueMapping={{}}
        onChange={vi.fn()}
      />
    );

    const unresolvedSelect = screen.getByLabelText(
      DEFAULT_LABELS.adhoc_vm_select_aria.replace("{value}", "قيد المراجعة")
    ) as HTMLSelectElement;
    // Placeholder, never `options[0]`.
    expect(unresolvedSelect.value).toBe("");
    expect(screen.getByText(DEFAULT_LABELS.adhoc_vm_unresolved_badge)).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_LABELS.adhoc_vm_unresolved_count.replace("{count}", "1"))
    ).toBeInTheDocument();

    // …while the confidently-seeded value beside it is resolved.
    const seededSelect = screen.getByLabelText(
      DEFAULT_LABELS.adhoc_vm_select_aria.replace("{value}", "سليم")
    ) as HTMLSelectElement;
    expect(seededSelect.value).toBe("سليمة");
  });

  it("pushes the confident seeds up on mount without clobbering existing entries", () => {
    const onChange = vi.fn<(next: ValueMapping) => void>();
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={ROWS}
        header={HEADER}
        valueMapping={{ "قيد المراجعة": "اشتباه" }}
        onChange={onChange}
      />
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      "سليم": "سليمة",
      "قيد المراجعة": "اشتباه",
    });
  });

  it("writes the chosen canonical value and deletes the key when cleared", () => {
    const onChange = vi.fn<(next: ValueMapping) => void>();
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={ROWS}
        header={HEADER}
        valueMapping={{ "سليم": "سليمة", "قيد المراجعة": "اشتباه" }}
        onChange={onChange}
      />
    );
    onChange.mockClear();

    const select = screen.getByLabelText(
      DEFAULT_LABELS.adhoc_vm_select_aria.replace("{value}", "قيد المراجعة")
    );
    fireEvent.change(select, { target: { value: "سليمة" } });
    expect(onChange).toHaveBeenLastCalledWith({
      "سليم": "سليمة",
      "قيد المراجعة": "سليمة",
    });

    fireEvent.change(select, { target: { value: "" } });
    // Cleared back to undecided by DELETION — storing "" would read as a decision.
    expect(onChange).toHaveBeenLastCalledWith({ "سليم": "سليمة" });
  });

  it("reports all-resolved when every distinct value has a target", () => {
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={[row(2, "سليمة"), row(3, "اشتباه")]}
        header={HEADER}
        valueMapping={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText(DEFAULT_LABELS.adhoc_vm_all_resolved)).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_LABELS.adhoc_vm_unresolved_badge)).toBeNull();
  });

  it("says so instead of rendering an empty table when the column has no values", () => {
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={[{ sourceRowNumber: 2, values: { [HEADER]: null } }]}
        header={HEADER}
        valueMapping={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText(DEFAULT_LABELS.adhoc_vm_no_values)).toBeInTheDocument();
  });

  it("disables every select when disabled", () => {
    render(
      <ValueMappingPanel
        field={RESULT_FIELD}
        rows={ROWS}
        header={HEADER}
        valueMapping={{}}
        onChange={vi.fn()}
        disabled
      />
    );

    const table = screen.getByRole("table");
    for (const select of within(table).getAllByRole("combobox")) {
      expect(select).toBeDisabled();
    }
  });
});
