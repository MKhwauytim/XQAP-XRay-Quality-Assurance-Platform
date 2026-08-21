/* @vitest-environment jsdom */
// The workbench is CertScanGrid's highlighter mechanic applied to a 19-field
// catalog: arm a field, click a column HEADER, done. The tests below pin the
// three things that mechanic can get wrong — a header click that fires with
// nothing armed, a manual binding that a re-render or a second auto-detect
// pass silently reverts, and a required field whose missing binding stops being
// visible.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import type {
  AdhocField,
  ImportMapping,
  SourceTable,
} from "../../../../data/adhocImport/adhocImportModel";
import MappingWorkbench from "./MappingWorkbench";

afterEach(cleanup);

const CATALOG: AdhocField[] = [
  {
    key: "xrayImageId",
    labelAr: "معرف الأشعة",
    required: true,
    kind: "text",
    seedAliases: ["معرف الأشعة"],
  },
  {
    key: "portName",
    labelAr: "اسم المنفذ",
    required: false,
    kind: "text",
    seedAliases: ["اسم المنفذ"],
  },
  {
    key: "xrayLevelOneResult",
    labelAr: "نتيجة المستوى الأول",
    required: false,
    kind: "enum",
    options: ["سليمة", "اشتباه"],
    // "النتيجة" below is deliberately NOT an alias, so auto-detection leaves
    // this field open for the manual-binding tests to drive.
    seedAliases: ["نتيجة المستوى الأول"],
  },
];

const TABLE: SourceTable = {
  sheetName: "ورقة1",
  headers: ["معرف الأشعة", "اسم المنفذ", "النتيجة"],
  rows: [
    { sourceRowNumber: 2, values: { "معرف الأشعة": "XR-1", "اسم المنفذ": "ميناء جدة", "النتيجة": "سليم" } },
    { sourceRowNumber: 3, values: { "معرف الأشعة": "XR-2", "اسم المنفذ": "ميناء الدمام", "النتيجة": "اشتباه" } },
  ],
};

const EMPTY_MAPPING: ImportMapping = { fields: {}, valueMappings: {} };

type HarnessProps = {
  table?: SourceTable;
  initial?: ImportMapping;
  onChange?: (next: ImportMapping) => void;
};

/** Mirrors how the tab will own the mapping: the workbench is fully controlled. */
function Harness({ table = TABLE, initial = EMPTY_MAPPING, onChange }: HarnessProps) {
  const [mapping, setMapping] = useState<ImportMapping>(initial);
  const [bump, setBump] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setBump(bump + 1)}>
        force-rerender-{bump}
      </button>
      <MappingWorkbench
        table={table}
        catalog={CATALOG}
        mapping={mapping}
        onMappingChange={(next) => {
          onChange?.(next);
          setMapping(next);
        }}
      />
    </div>
  );
}

function armField(labelAr: string): void {
  fireEvent.click(
    screen.getByRole("button", {
      name: DEFAULT_LABELS.adhoc_map_arm_aria.replace("{field}", labelAr),
    })
  );
}

function clickColumnHeader(header: string): void {
  const grid = screen.getByRole("table", {
    name: DEFAULT_LABELS.adhoc_map_grid_pane_title,
  });
  fireEvent.click(within(grid).getByRole("button", { name: header }));
}

function bindingText(header: string): string {
  return DEFAULT_LABELS.adhoc_map_column_label.replace("{header}", header);
}

describe("MappingWorkbench", () => {
  it("auto-detects once on mount into an untouched mapping", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(<Harness onChange={onChange} />);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.fields.xrayImageId).toEqual({ kind: "column", header: "معرف الأشعة" });
    expect(next.fields.portName).toEqual({ kind: "column", header: "اسم المنفذ" });
    // No alias matched "النتيجة", and a second-best header is never invented.
    expect(next.fields.xrayLevelOneResult).toEqual({ kind: "none" });
  });

  it("never auto-detects over a mapping that already carries a decision", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(
      <Harness
        onChange={onChange}
        initial={{
          fields: { xrayImageId: { kind: "column", header: "النتيجة" } },
          valueMappings: {},
        }}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(bindingText("النتيجة"))).toBeInTheDocument();
  });

  it("assigns the clicked column header to the armed field", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(<Harness onChange={onChange} />);
    onChange.mockClear();

    armField("نتيجة المستوى الأول");
    expect(screen.getByText(DEFAULT_LABELS.adhoc_map_cursor_hint)).toBeInTheDocument();

    clickColumnHeader("النتيجة");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].fields.xrayLevelOneResult).toEqual({
      kind: "column",
      header: "النتيجة",
    });
    // Arming is one-shot, exactly as in CertScanGrid.
    expect(screen.queryByText(DEFAULT_LABELS.adhoc_map_cursor_hint)).toBeNull();
    expect(screen.getByText(DEFAULT_LABELS.adhoc_map_origin_manual)).toBeInTheDocument();
  });

  it("does nothing when a column header is clicked with nothing armed", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(<Harness onChange={onChange} />);
    onChange.mockClear();

    clickColumnHeader("النتيجة");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(bindingText("النتيجة"))).toBeNull();
  });

  it("keeps a manual override across a re-render", () => {
    render(<Harness />);

    // Re-point the id field away from what auto-detection proposed.
    armField("معرف الأشعة");
    clickColumnHeader("النتيجة");
    expect(screen.getByText(bindingText("النتيجة"))).toBeInTheDocument();

    fireEvent.click(screen.getByText("force-rerender-0"));

    // A second auto-detect pass would restore "معرف الأشعة" here.
    expect(screen.getByText(bindingText("النتيجة"))).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.adhoc_map_origin_manual)).toBeInTheDocument();
  });

  it("writes a constant source when the constant toggle is switched on", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(<Harness onChange={onChange} />);
    onChange.mockClear();

    fireEvent.click(
      screen.getByLabelText(
        DEFAULT_LABELS.adhoc_map_constant_toggle_aria.replace("{field}", "اسم المنفذ")
      )
    );
    expect(onChange.mock.calls[0][0].fields.portName).toEqual({
      kind: "constant",
      value: "",
    });

    fireEvent.change(
      screen.getByLabelText(
        DEFAULT_LABELS.adhoc_map_constant_aria.replace("{field}", "اسم المنفذ")
      ),
      { target: { value: "ميناء جدة" } }
    );
    expect(onChange.mock.calls[1][0].fields.portName).toEqual({
      kind: "constant",
      value: "ميناء جدة",
    });
    expect(screen.getByText(DEFAULT_LABELS.adhoc_map_origin_constant)).toBeInTheDocument();
  });

  it("clears a field back to none", () => {
    const onChange = vi.fn<(next: ImportMapping) => void>();
    render(<Harness onChange={onChange} />);
    onChange.mockClear();

    fireEvent.click(
      screen.getByRole("button", {
        name: DEFAULT_LABELS.adhoc_map_clear_field_aria.replace("{field}", "اسم المنفذ"),
      })
    );

    expect(onChange.mock.calls[0][0].fields.portName).toEqual({ kind: "none" });
    expect(screen.queryByText(bindingText("اسم المنفذ"))).toBeNull();
  });

  it("warns on a required field with no source, in the row and in the banner", () => {
    render(
      <Harness
        table={{
          sheetName: "ورقة1",
          headers: ["عمود مجهول"],
          rows: [{ sourceRowNumber: 2, values: { "عمود مجهول": "قيمة" } }],
        }}
      />
    );

    expect(
      screen.getByText(DEFAULT_LABELS.adhoc_map_required_unmapped_badge)
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.adhoc_map_issues_title)).toBeInTheDocument();
    expect(
      screen.getByText(/الحقل الإلزامي "معرف الأشعة" غير مرتبط/)
    ).toBeInTheDocument();
  });

  it("offers value mapping only for an enum field that has a column", () => {
    render(<Harness />);

    // Nothing is bound to the enum field yet, so the expander is absent.
    expect(
      screen.queryByRole("button", { name: DEFAULT_LABELS.adhoc_map_value_mapping_toggle })
    ).toBeNull();

    armField("نتيجة المستوى الأول");
    clickColumnHeader("النتيجة");

    const expander = screen.getByRole("button", {
      name: DEFAULT_LABELS.adhoc_map_value_mapping_toggle,
    });
    fireEvent.click(expander);

    expect(
      screen.getByText(
        DEFAULT_LABELS.adhoc_vm_title.replace("{field}", "نتيجة المستوى الأول")
      )
    ).toBeInTheDocument();
  });
});
