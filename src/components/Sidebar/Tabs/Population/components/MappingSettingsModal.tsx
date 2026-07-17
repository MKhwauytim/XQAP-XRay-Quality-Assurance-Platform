import { Settings2, X } from "lucide-react";
import { ConfirmDialog } from "../../../../ConfirmDialog/ConfirmDialog";
import type { PopulationConfig } from "../../../../../data/population/populationConfig";
import { ColumnMappingsSection } from "./ColumnMappingsSection";
import {
  ExportColumnsSection,
  StageMappingsSection,
  WorkbookSheetsSection,
} from "./MappingSettingsSecondarySections";
import { MappingSettingsTabBar } from "./MappingSettingsTabBar";
import { ProcessingWorkflowSection } from "./ProcessingWorkflowSection";
import {
  type MappingSettingsProcessingContext,
  useMappingSettingsController,
} from "./useMappingSettingsController";

type MappingSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  config: PopulationConfig;
  onConfigChange: (config: PopulationConfig) => void;
  mode?: "mapping" | "processing";
  processingContext?: MappingSettingsProcessingContext;
};

export default function MappingSettingsModal({
  isOpen,
  onClose,
  config,
  onConfigChange,
  mode = "mapping",
  processingContext,
}: MappingSettingsModalProps) {
  const controller = useMappingSettingsController({
    isOpen,
    mode,
    config,
    onConfigChange,
    processingContext,
  });

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
        direction: "rtl",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapping-settings-title"
        style={{
          background: "var(--population-bg-card, #ffffff)",
          border: "1px solid var(--population-border, #e0e0e0)",
          borderRadius: "16px",
          width: "90%",
          maxWidth: mode === "processing" ? "1180px" : "800px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.15)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid var(--population-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            id="mapping-settings-title"
            style={{ fontSize: "18px", fontWeight: "bold", margin: 0 }}
          >
            <Settings2
              size={18}
              style={{ verticalAlign: "middle", marginInlineEnd: 6 }}
            />
            {mode === "processing"
              ? "إعدادات المعالجة"
              : "إعدادات الربط والخرائط والتصدير"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق إعدادات الربط"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--population-muted)",
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {mode === "mapping" && (
          <MappingSettingsTabBar
            activeTab={controller.activeTab}
            onChange={controller.setActiveTab}
          />
        )}

        <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
          {controller.activeTab === "mappings" && (
            <ColumnMappingsSection
              config={config}
              template={controller.template}
              newFieldName={controller.newFieldName}
              newFieldLabel={controller.newFieldLabel}
              setNewFieldName={controller.setNewFieldName}
              setNewFieldLabel={controller.setNewFieldLabel}
              setPendingRemoval={controller.setPendingRemoval}
              handleToggleSystemFieldRequired={
                controller.handleToggleSystemFieldRequired
              }
              handleMappingChange={controller.handleMappingChange}
              handleBiMappingChange={controller.handleBiMappingChange}
              handleAddCustomField={controller.handleAddCustomField}
            />
          )}

          {controller.activeTab === "processing" && (
            <ProcessingWorkflowSection
              workflow={controller.workflow}
              workflowSteps={controller.workflowSteps}
              selectedWorkflowStep={controller.selectedWorkflowStep}
              setSelectedWorkflowStepId={
                controller.setSelectedWorkflowStepId
              }
              newStepTitle={controller.newStepTitle}
              setNewStepTitle={controller.setNewStepTitle}
              processingMapView={controller.processingMapView}
              setProcessingMapView={controller.setProcessingMapView}
              dataSourceCards={controller.dataSourceCards}
              stepKindLabels={controller.stepKindLabels}
              fieldOptions={controller.fieldOptions}
              finalRows={processingContext?.finalRows ?? null}
              handleApplyWorkflowPreset={
                controller.handleApplyWorkflowPreset
              }
              handleAddWorkflowStep={controller.handleAddWorkflowStep}
              handleInsertWorkflowStepAfter={
                controller.handleInsertWorkflowStepAfter
              }
              handleWorkflowStepChange={
                controller.handleWorkflowStepChange
              }
              handleMoveWorkflowStep={controller.handleMoveWorkflowStep}
              handleRemoveWorkflowStep={controller.handleRemoveWorkflowStep}
            />
          )}

          {controller.activeTab === "stages" && (
            <StageMappingsSection
              stageMappings={controller.stageMappings}
              onChange={controller.handleStageMappingChange}
              onReset={controller.handleResetStageMappings}
            />
          )}

          {controller.activeTab === "sheets" && (
            <WorkbookSheetsSection
              template={controller.template}
              fields={controller.fieldOptions}
              riskSheetNames={controller.riskSheetNames}
              biSheetNames={controller.biSheetNames}
              riskColumnHints={processingContext?.riskColumnHints ?? {}}
              biColumnHints={processingContext?.biColumnHints ?? {}}
              onApplyDetected={
                controller.handleApplyDetectedWorkbookSettings
              }
              onPatternChange={controller.handleSheetPatternChange}
            />
          )}

          {controller.activeTab === "exports" && (
            <ExportColumnsSection
              config={config}
              onMove={controller.handleMoveColumn}
              onChange={controller.handleExportColumnChange}
            />
          )}
        </div>

        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--population-border)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="primary-action" onClick={onClose}>
            حفظ وإغلاق
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={controller.pendingRemoval !== null}
        danger
        title="حذف الحقل"
        message={
          controller.pendingRemoval?.kind === "system"
            ? `هل أنت متأكد من حذف الحقل "${controller.pendingRemoval.key}" من القائمة؟ يمكنك استعادته من الإعدادات الافتراضية.`
            : "هل أنت متأكد من حذف هذا الحقل المخصص؟"
        }
        confirmLabel="حذف"
        onConfirm={() => {
          const removal = controller.pendingRemoval;
          controller.setPendingRemoval(null);
          if (!removal) return;
          if (removal.kind === "system") {
            controller.handleRemoveSystemField(removal.key);
          } else {
            controller.handleRemoveCustomField(removal.key);
          }
        }}
        onCancel={() => controller.setPendingRemoval(null)}
      />
    </div>
  );
}
