/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_STAGE_MAPPINGS,
  type PopulationConfig,
} from "../../../../../data/population/populationConfig";
import { useMappingSettingsController } from "./useMappingSettingsController";

function configFixture(): PopulationConfig {
  return structuredClone(DEFAULT_POPULATION_CONFIG);
}

function latestConfig(callback: ReturnType<typeof vi.fn>): PopulationConfig {
  const value = callback.mock.lastCall?.[0] as PopulationConfig | undefined;
  if (!value) throw new Error("Expected onConfigChange to receive a config.");
  return value;
}

function setup(
  config = configFixture(),
  options?: {
    mode?: "mapping" | "processing";
    isOpen?: boolean;
    processingContext?: Parameters<typeof useMappingSettingsController>[0]["processingContext"];
  },
) {
  const onConfigChange = vi.fn();
  const initialProps = {
    config,
    onConfigChange,
    isOpen: options?.isOpen ?? true,
    mode: options?.mode ?? ("mapping" as const),
    processingContext: options?.processingContext,
  };
  const hook = renderHook(
    (props: typeof initialProps) => useMappingSettingsController(props),
    { initialProps },
  );
  return { ...hook, onConfigChange, initialProps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMappingSettingsController characterization", () => {
  it("resets the requested tab on reopen and when switching modal mode", () => {
    const { result, rerender, initialProps } = setup();

    act(() => result.current.setActiveTab("exports"));
    expect(result.current.activeTab).toBe("exports");

    rerender({ ...initialProps, isOpen: false });
    expect(result.current.activeTab).toBe("exports");

    rerender({ ...initialProps, isOpen: true });
    expect(result.current.activeTab).toBe("mappings");

    rerender({ ...initialProps, isOpen: true, mode: "processing" });
    expect(result.current.activeTab).toBe("processing");
  });

  it("updates Risk, BI, sheet, stage, and required-field mappings", () => {
    const { result, onConfigChange } = setup();

    act(() => result.current.handleMappingChange("xrayImageId", "Risk ID, , Scan ID"));
    expect(latestConfig(onConfigChange).mappingTemplates[0]!.columnMappings.xrayImageId)
      .toEqual(["Risk ID", "Scan ID"]);

    act(() => result.current.handleBiMappingChange("xrayImageId", "BI ID, Image ID"));
    expect(latestConfig(onConfigChange).mappingTemplates[0]!.biColumnMappings?.xrayImageId)
      .toEqual(["BI ID", "Image ID"]);

    act(() => result.current.handleSheetPatternChange("risk", "Road, Sea"));
    expect(latestConfig(onConfigChange).mappingTemplates[0]!.sheetPatterns.risk)
      .toEqual(["Road", "Sea"]);

    act(() => result.current.handleStageMappingChange("first", "FIRST, 1"));
    expect(latestConfig(onConfigChange).stageMappings.first).toEqual(["FIRST", "1"]);

    const wasRequired = result.current.template.columnMappings.xrayImageId !== undefined &&
      DEFAULT_POPULATION_CONFIG.systemFields[0]!.isRequired;
    act(() => result.current.handleToggleSystemFieldRequired("xrayImageId"));
    expect(latestConfig(onConfigChange).systemFields[0]!.isRequired).toBe(!wasRequired);

    act(() => result.current.handleResetStageMappings());
    expect(latestConfig(onConfigChange).stageMappings).toEqual(DEFAULT_STAGE_MAPPINGS);
  });

  it("merges detected workbook settings without losing configured aliases", () => {
    const { result, onConfigChange } = setup(configFixture(), {
      processingContext: {
        riskFileName: "risk.xlsx",
        biFileName: "bi.xlsx",
        riskRows: 10,
        biRows: 8,
        certScanProvided: true,
        finalRows: 7,
        riskSheetNames: ["Risk 2026"],
        biSheetNames: ["BI 2026"],
        riskColumnHints: { xrayImageId: ["XRAY_SCAN_ID", "Detected Risk ID"] },
        biColumnHints: { xrayImageId: ["Detected BI ID"] },
      },
    });

    act(() => result.current.handleApplyDetectedWorkbookSettings());
    const next = latestConfig(onConfigChange).mappingTemplates[0]!;

    expect(next.sheetPatterns).toEqual({ risk: ["Risk 2026"], bi: ["BI 2026"] });
    expect(next.columnMappings.xrayImageId).toContain("Detected Risk ID");
    expect(next.biColumnMappings?.xrayImageId).toContain("Detected BI ID");
    expect(next.columnMappings.xrayImageId).toContain("XRAY_SCAN_ID");
  });

  it("adds, edits, reorders, inserts, removes, and presets workflow steps", () => {
    const randomUuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("12345678-1234-4234-8234-123456789abc");
    const { result, onConfigChange, rerender, initialProps } = setup();
    const firstId = result.current.workflowSteps[0]!.stepId;

    act(() => result.current.handleWorkflowStepChange(firstId, { titleAr: "عنوان معدل" }));
    expect(latestConfig(onConfigChange).processingWorkflow.steps[0]!.titleAr)
      .toBe("عنوان معدل");

    act(() => result.current.handleMoveWorkflowStep(firstId, "down"));
    const moved = latestConfig(onConfigChange).processingWorkflow.steps;
    expect(moved[1]!.stepId).toBe(firstId);
    expect(moved.map((step) => step.order).slice(0, 2)).toEqual([10, 20]);

    act(() => result.current.setNewStepTitle("خطوة اختبار"));
    act(() => result.current.handleAddWorkflowStep());
    const addedConfig = latestConfig(onConfigChange);
    expect(addedConfig.processingWorkflow.steps.at(-1)).toMatchObject({
      stepId: "custom-12345678",
      titleAr: "خطوة اختبار",
      kind: "custom",
    });
    expect(result.current.newStepTitle).toBe("");

    rerender({ ...initialProps, config: addedConfig });
    act(() => result.current.handleInsertWorkflowStepAfter(firstId));
    const insertedConfig = latestConfig(onConfigChange);
    expect(insertedConfig.processingWorkflow.steps[1]!.stepId).toBe("custom-12345678");

    rerender({ ...initialProps, config: insertedConfig });
    act(() => result.current.handleRemoveWorkflowStep("custom-12345678"));
    expect(latestConfig(onConfigChange).processingWorkflow.steps)
      .not.toContainEqual(expect.objectContaining({ stepId: "custom-12345678" }));

    act(() => result.current.handleApplyWorkflowPreset("minimal"));
    expect(latestConfig(onConfigChange).processingWorkflow.activePresetId).toBe("minimal");
    expect(randomUuid).toHaveBeenCalledTimes(2);
  });

  it("adds/removes fields and edits/reorders export columns", () => {
    const { result, onConfigChange, rerender, initialProps } = setup();

    act(() => result.current.setNewFieldName("inspectionLocation"));
    act(() => result.current.setNewFieldLabel("موقع التفتيش"));
    act(() => result.current.handleAddCustomField());
    const added = latestConfig(onConfigChange);
    expect(added.customFields).toContainEqual({
      key: "inspectionLocation",
      labelAr: "موقع التفتيش",
      dataType: "string",
    });
    expect(added.mappingTemplates[0]!.columnMappings.inspectionLocation)
      .toEqual(["موقع التفتيش"]);
    expect(added.exportTemplates[0]!.columns.at(-1)?.fieldKey)
      .toBe("inspectionLocation");

    rerender({ ...initialProps, config: added });
    act(() => result.current.handleRemoveCustomField("inspectionLocation"));
    const removed = latestConfig(onConfigChange);
    expect(removed.customFields).toEqual([]);
    expect(removed.mappingTemplates[0]!.columnMappings.inspectionLocation).toBeUndefined();
    expect(removed.exportTemplates[0]!.columns)
      .not.toContainEqual(expect.objectContaining({ fieldKey: "inspectionLocation" }));

    const firstTwo = [...added.exportTemplates[0]!.columns]
      .sort((left, right) => left.order - right.order)
      .slice(0, 2);
    act(() => result.current.handleMoveColumn(firstTwo[0]!.fieldKey, "down"));
    const reordered = [...latestConfig(onConfigChange).exportTemplates[0]!.columns]
      .sort((left, right) => left.order - right.order);
    expect(reordered[0]!.fieldKey).toBe(firstTwo[1]!.fieldKey);
    expect(reordered[1]!.fieldKey).toBe(firstTwo[0]!.fieldKey);

    act(() =>
      result.current.handleExportColumnChange(
        firstTwo[0]!.fieldKey,
        "exportHeader",
        "عنوان جديد",
      ),
    );
    expect(
      latestConfig(onConfigChange).exportTemplates[0]!.columns.find(
        (column) => column.fieldKey === firstTwo[0]!.fieldKey,
      )?.exportHeader,
    ).toBe("عنوان جديد");
  });

  it("uses the latest controlled config after a parent rerender", () => {
    const { result, onConfigChange, rerender, initialProps } = setup();
    const newest = configFixture();
    newest.employeeAllocations = [
      {
        username: "latest-user",
        stageKey: "first",
        method: "exact",
        value: 1,
        isActive: true,
      },
    ];
    newest.mappingTemplates[0]!.columnMappings.xrayImageId = ["LATEST"];

    rerender({ ...initialProps, config: newest });
    act(() => result.current.handleMappingChange("portName", "Latest Port"));

    const emitted = latestConfig(onConfigChange);
    expect(emitted.employeeAllocations).toEqual(newest.employeeAllocations);
    expect(emitted.mappingTemplates[0]!.columnMappings.xrayImageId).toEqual(["LATEST"]);
    expect(emitted.mappingTemplates[0]!.columnMappings.portName).toEqual(["Latest Port"]);
  });
});
