/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POPULATION_CONFIG,
  type PopulationConfig,
} from "../../../../../data/population/populationConfig";
import MappingSettingsModal from "./MappingSettingsModal";

function compactConfig(): PopulationConfig {
  const config = structuredClone(DEFAULT_POPULATION_CONFIG);
  config.systemFields = config.systemFields.slice(0, 1);
  config.exportTemplates[0]!.columns = config.exportTemplates[0]!.columns.slice(0, 2);
  config.mappingTemplates[0]!.sheetPatterns = { risk: ["Risk"], bi: ["BI"] };
  return config;
}

afterEach(cleanup);

describe("MappingSettingsModal behavior wiring", () => {
  it("routes changes from every mapping tab to the controlled config callback", () => {
    const config = compactConfig();
    const onConfigChange = vi.fn();
    render(
      <MappingSettingsModal
        isOpen
        onClose={vi.fn()}
        config={config}
        onConfigChange={onConfigChange}
        processingContext={{
          riskFileName: "risk.xlsx",
          biFileName: "bi.xlsx",
          riskRows: 2,
          biRows: 2,
          certScanProvided: false,
          finalRows: 2,
          riskSheetNames: ["Detected Risk"],
          biSheetNames: ["Detected BI"],
          riskColumnHints: { xrayImageId: ["Detected ID"] },
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("أسماء الأعمدة في ملف المخاطر..."), {
      target: { value: "Risk ID" },
    });
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingTemplates: expect.arrayContaining([
          expect.objectContaining({
            columnMappings: expect.objectContaining({ xrayImageId: ["Risk ID"] }),
          }),
        ]),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "ترجمة المستويات" }));
    fireEvent.change(screen.getByLabelText("المستوى الأول"), {
      target: { value: "FIRST, 1" },
    });
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stageMappings: expect.objectContaining({ first: ["FIRST", "1"] }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "أوراق العمل (Tabs)" }));
    fireEvent.click(
      screen.getByRole("button", { name: "تطبيق الأسماء والأعمدة المكتشفة" }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mappingTemplates: expect.arrayContaining([
          expect.objectContaining({
            sheetPatterns: { risk: ["Detected Risk"], bi: ["Detected BI"] },
          }),
        ]),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "أعمدة التصدير" }));
    fireEvent.change(screen.getByDisplayValue(config.exportTemplates[0]!.columns[0]!.exportHeader), {
      target: { value: "عنوان جديد" },
    });
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exportTemplates: expect.arrayContaining([
          expect.objectContaining({
            columns: expect.arrayContaining([
              expect.objectContaining({ exportHeader: "عنوان جديد" }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("resets to mappings after close/reopen and exposes processing mode", () => {
    const props = {
      onClose: vi.fn(),
      config: compactConfig(),
      onConfigChange: vi.fn(),
    };
    const { rerender } = render(<MappingSettingsModal isOpen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "أعمدة التصدير" }));
    expect(screen.getByText("تحكم في تفعيل أو تعطيل، ترتيب، وتغيير عناوين الأعمدة المخرجة عند تصدير العينات لملفات Excel.")).toBeTruthy();

    rerender(<MappingSettingsModal isOpen={false} {...props} />);
    rerender(<MappingSettingsModal isOpen {...props} />);
    expect(screen.getByPlaceholderText("أسماء الأعمدة في ملف المخاطر...")).toBeTruthy();

    rerender(<MappingSettingsModal isOpen mode="processing" {...props} />);
    expect(screen.getByRole("heading", { name: "إعدادات المعالجة" })).toBeTruthy();
  });
});
