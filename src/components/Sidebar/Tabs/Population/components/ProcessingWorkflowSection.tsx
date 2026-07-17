import type { Dispatch, SetStateAction } from "react";
import type {
  ProcessingStepKind,
  ProcessingWorkflowConfig,
  ProcessingWorkflowStep,
} from "../../../../../data/population/populationConfig";
import { PROCESSING_WORKFLOW_PRESETS } from "../../../../../data/population/populationConfig";

type DataSourceCard = {
  id: string;
  label: string;
  detail: string;
  meta: string;
  isReady: boolean;
  feeds: string[];
};

type FieldOption = { key: string; label: string };

type ProcessingWorkflowSectionProps = {
  workflow: ProcessingWorkflowConfig;
  workflowSteps: ProcessingWorkflowStep[];
  selectedWorkflowStep: ProcessingWorkflowStep | null;
  setSelectedWorkflowStepId: Dispatch<SetStateAction<string | null>>;
  newStepTitle: string;
  setNewStepTitle: Dispatch<SetStateAction<string>>;
  processingMapView: "topDown" | "horizontal";
  setProcessingMapView: Dispatch<SetStateAction<"topDown" | "horizontal">>;
  dataSourceCards: DataSourceCard[];
  stepKindLabels: Record<ProcessingStepKind, string>;
  fieldOptions: FieldOption[];
  finalRows: number | null;
  handleApplyWorkflowPreset: (presetId: string) => void;
  handleAddWorkflowStep: () => void;
  handleInsertWorkflowStepAfter: (stepId: string) => void;
  handleWorkflowStepChange: (
    stepId: string,
    patch: Partial<ProcessingWorkflowStep>,
  ) => void;
  handleMoveWorkflowStep: (stepId: string, direction: "up" | "down") => void;
  handleRemoveWorkflowStep: (stepId: string) => void;
};

export function ProcessingWorkflowSection({
  workflow,
  workflowSteps,
  selectedWorkflowStep,
  setSelectedWorkflowStepId,
  newStepTitle,
  setNewStepTitle,
  processingMapView,
  setProcessingMapView,
  dataSourceCards,
  stepKindLabels,
  fieldOptions,
  finalRows,
  handleApplyWorkflowPreset,
  handleAddWorkflowStep,
  handleInsertWorkflowStepAfter,
  handleWorkflowStepChange,
  handleMoveWorkflowStep,
  handleRemoveWorkflowStep,
}: ProcessingWorkflowSectionProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.45fr) minmax(280px, 0.9fr)",
        gap: "16px",
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <label className="save-disk-label" style={{ flex: "1 1 260px" }}>
            قالب خريطة المعالجة
            <select
              className="save-disk-input"
              value={workflow.activePresetId}
              onChange={(event) =>
                handleApplyWorkflowPreset(event.target.value)
              }
            >
              {PROCESSING_WORKFLOW_PRESETS.map((preset) => (
                <option key={preset.presetId} value={preset.presetId}>
                  {preset.nameAr}
                </option>
              ))}
              <option value="custom">قالب مخصص</option>
            </select>
          </label>
          <label className="save-disk-label" style={{ flex: "1 1 240px" }}>
            إضافة خطوة سريعة
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                className="save-disk-input"
                placeholder="مثال: نقل قيمة من عمود إلى آخر"
                value={newStepTitle}
                onChange={(event) => setNewStepTitle(event.target.value)}
              />
              <button
                type="button"
                className="primary-action"
                style={{ height: "36px", whiteSpace: "nowrap" }}
                onClick={handleAddWorkflowStep}
              >
                إضافة
              </button>
            </div>
          </label>
          <div
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              alignSelf: "flex-end",
              background: "#f1f5f9",
              border: "1px solid #dce4ee",
              borderRadius: "10px",
              padding: "4px",
            }}
          >
            <button
              type="button"
              onClick={() => setProcessingMapView("topDown")}
              style={{
                border: "none",
                borderRadius: "7px",
                padding: "7px 10px",
                cursor: "pointer",
                background:
                  processingMapView === "topDown"
                    ? "var(--population-primary)"
                    : "transparent",
                color: processingMapView === "topDown" ? "#fff" : "#334155",
                fontWeight: 800,
                fontSize: "12px",
              }}
            >
              عرض علوي
            </button>
            <button
              type="button"
              onClick={() => setProcessingMapView("horizontal")}
              style={{
                border: "none",
                borderRadius: "7px",
                padding: "7px 10px",
                cursor: "pointer",
                background:
                  processingMapView === "horizontal"
                    ? "var(--population-primary)"
                    : "transparent",
                color: processingMapView === "horizontal" ? "#fff" : "#334155",
                fontWeight: 800,
                fontSize: "12px",
              }}
            >
              عرض أفقي
            </button>
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--population-border)",
            borderRadius: "14px",
            background: "#f8fafc",
            padding: "16px",
            minHeight: "460px",
            overflowX: "auto",
          }}
        >
          {processingMapView === "topDown" ? (
            <div style={{ display: "grid", gap: "14px", minWidth: "620px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(150px, 1fr))",
                  gap: "10px",
                }}
              >
                {dataSourceCards.map((source) => (
                  <div
                    key={source.id}
                    style={{
                      border: source.isReady
                        ? "1px solid #86efac"
                        : "1px solid #dce4ee",
                      borderRadius: "12px",
                      background: source.isReady ? "#f0fdf4" : "#fff",
                      padding: "10px",
                      minHeight: "98px",
                    }}
                  >
                    <strong style={{ color: "#17365d", fontSize: "13px" }}>
                      {source.label}
                    </strong>
                    <p
                      style={{
                        margin: "6px 0",
                        color: "#334155",
                        fontSize: "12px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {source.detail}
                    </p>
                    <span
                      style={{
                        color: source.isReady ? "#166534" : "#94a3b8",
                        fontSize: "11px",
                        fontWeight: 800,
                      }}
                    >
                      {source.meta}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  textAlign: "center",
                  color: "#94a3b8",
                  fontWeight: 800,
                }}
              >
                ↓ البيانات تدخل إلى خطوات المعالجة ↓
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  alignItems: "center",
                }}
              >
                {workflowSteps.map((step, index) => {
                  const isSelected =
                    selectedWorkflowStep?.stepId === step.stepId;
                  const feeds = dataSourceCards.filter((source) =>
                    source.feeds.includes(step.kind),
                  );
                  return (
                    <div
                      key={step.stepId}
                      style={{
                        width: "100%",
                        maxWidth: "620px",
                        display: "grid",
                        gap: "6px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedWorkflowStepId(step.stepId)}
                        style={{
                          width: "100%",
                          border: isSelected
                            ? "2px solid var(--population-primary)"
                            : "1px solid #dce4ee",
                          borderRadius: "12px",
                          background: step.isEnabled ? "#fff" : "#eef2f7",
                          boxShadow: isSelected
                            ? "0 10px 26px rgba(23, 54, 93, 0.16)"
                            : "0 4px 12px rgba(15, 23, 42, 0.05)",
                          padding: "10px 12px",
                          cursor: "pointer",
                          textAlign: "right",
                          opacity: step.isEnabled ? 1 : 0.62,
                          display: "grid",
                          gridTemplateColumns: "42px 1fr auto",
                          gap: "10px",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "50%",
                            background: step.isEnabled
                              ? "var(--population-primary)"
                              : "#94a3b8",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 800,
                          }}
                        >
                          {index + 1}
                        </span>
                        <span>
                          <strong
                            style={{
                              display: "block",
                              color: "#172033",
                              fontSize: "13px",
                            }}
                          >
                            {step.titleAr}
                          </strong>
                          <span style={{ color: "#64748b", fontSize: "11px" }}>
                            {feeds.length > 0
                              ? `مدخلات: ${feeds.map((item) => item.label).join("، ")}`
                              : stepKindLabels[step.kind]}
                          </span>
                        </span>
                        <span
                          style={{
                            color: "#0f766e",
                            fontSize: "11px",
                            fontWeight: 800,
                            direction: "ltr",
                          }}
                        >
                          {step.sourceField || step.targetField
                            ? `${step.sourceField ?? "?"} → ${step.targetField ?? "?"}`
                            : "—"}
                        </span>
                      </button>
                      {index < workflowSteps.length - 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            handleInsertWorkflowStepAfter(step.stepId)
                          }
                          title="إرفاق خطوة هنا"
                          style={{
                            justifySelf: "center",
                            width: "30px",
                            height: "30px",
                            borderRadius: "50%",
                            border: "1px dashed var(--population-primary)",
                            background: "#fff",
                            color: "var(--population-primary)",
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  textAlign: "center",
                  color: "#94a3b8",
                  fontWeight: 800,
                }}
              >
                ↓
              </div>
              <div
                style={{
                  justifySelf: "center",
                  width: "min(100%, 360px)",
                  border: "1px solid #bfdbfe",
                  borderRadius: "12px",
                  background: "#eff6ff",
                  padding: "12px",
                  textAlign: "center",
                }}
              >
                <strong style={{ color: "#17365d" }}>
                  مجتمع المعالجة النهائي
                </strong>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "#334155",
                    fontSize: "12px",
                  }}
                >
                  {finalRows !== null && finalRows !== undefined
                    ? `${finalRows.toLocaleString("ar-SA-u-nu-latn")} صف جاهز`
                    : "يظهر بعد تشغيل المعالجة"}
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                minWidth: "720px",
              }}
            >
              {workflowSteps.map((step, index) => {
                const isSelected = selectedWorkflowStep?.stepId === step.stepId;
                const hasLink = Boolean(step.sourceField || step.targetField);
                return (
                  <div
                    key={step.stepId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedWorkflowStepId(step.stepId)}
                      style={{
                        width: "150px",
                        minHeight: "126px",
                        border: isSelected
                          ? "2px solid var(--population-primary)"
                          : "1px solid #dce4ee",
                        borderRadius: "12px",
                        background: step.isEnabled ? "#fff" : "#eef2f7",
                        boxShadow: isSelected
                          ? "0 10px 26px rgba(23, 54, 93, 0.16)"
                          : "0 4px 12px rgba(15, 23, 42, 0.05)",
                        padding: "10px",
                        cursor: "pointer",
                        textAlign: "right",
                        opacity: step.isEnabled ? 1 : 0.62,
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            width: "26px",
                            height: "26px",
                            borderRadius: "50%",
                            background: step.isEnabled
                              ? "var(--population-primary)"
                              : "#94a3b8",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 800,
                          }}
                        >
                          {index + 1}
                        </span>
                        <span
                          style={{
                            padding: "2px 7px",
                            borderRadius: "999px",
                            background: hasLink ? "#dcfce7" : "#eef2ff",
                            color: hasLink ? "#166534" : "#3730a3",
                            fontSize: "10.5px",
                            fontWeight: 800,
                          }}
                        >
                          {hasLink ? "مرتبط" : stepKindLabels[step.kind]}
                        </span>
                      </span>
                      <strong
                        style={{
                          color: "#172033",
                          fontSize: "13px",
                          lineHeight: 1.45,
                        }}
                      >
                        {step.titleAr}
                      </strong>
                      <span
                        style={{
                          color: "#64748b",
                          fontSize: "11px",
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {step.descriptionAr}
                      </span>
                      {(step.sourceField || step.targetField) && (
                        <span
                          style={{
                            marginTop: "auto",
                            color: "#0f766e",
                            fontSize: "11px",
                            fontWeight: 700,
                            direction: "ltr",
                            textAlign: "left",
                          }}
                        >
                          {step.sourceField ?? "?"} → {step.targetField ?? "?"}
                        </span>
                      )}
                    </button>
                    {index < workflowSteps.length - 1 && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <span style={{ color: "#94a3b8", fontWeight: 800 }}>
                          ←
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleInsertWorkflowStepAfter(step.stepId)
                          }
                          title="إرفاق خطوة هنا"
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            border: "1px dashed var(--population-primary)",
                            background: "#fff",
                            color: "var(--population-primary)",
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <aside
        style={{
          border: "1px solid var(--population-border)",
          borderRadius: "14px",
          background: "#fff",
          padding: "14px",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
          position: "sticky",
          top: 0,
        }}
      >
        {selectedWorkflowStep ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <div>
                <strong
                  style={{
                    color: "var(--population-primary)",
                    fontSize: "15px",
                  }}
                >
                  خصائص الخطوة
                </strong>
                <p
                  style={{
                    margin: "4px 0 0",
                    color: "var(--population-muted)",
                    fontSize: "12px",
                  }}
                >
                  اربط الحقول أو غيّر موضع الخطوة من هنا.
                </p>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "var(--population-muted)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedWorkflowStep.isEnabled}
                  onChange={(event) =>
                    handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                      isEnabled: event.target.checked,
                    })
                  }
                />
                مفعل
              </label>
            </div>

            <label className="save-disk-label">
              اسم الخطوة
              <input
                type="text"
                className="save-disk-input"
                value={selectedWorkflowStep.titleAr}
                onChange={(event) =>
                  handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                    titleAr: event.target.value,
                  })
                }
              />
            </label>

            <label className="save-disk-label">
              نوع الخطوة
              <select
                className="save-disk-input"
                value={selectedWorkflowStep.kind}
                onChange={(event) =>
                  handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                    kind: event.target.value as ProcessingStepKind,
                  })
                }
              >
                {(Object.keys(stepKindLabels) as ProcessingStepKind[]).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {stepKindLabels[kind]}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="save-disk-label">
              وصف الخطوة
              <textarea
                className="save-disk-input"
                rows={3}
                value={selectedWorkflowStep.descriptionAr}
                onChange={(event) =>
                  handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                    descriptionAr: event.target.value,
                  })
                }
                style={{ resize: "vertical", minHeight: "72px" }}
              />
            </label>

            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "10px",
                background: "#f8fafc",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: "8px",
                  color: "#334155",
                  fontSize: "13px",
                }}
              >
                ربط أو إرفاق الحقول
              </strong>
              <label
                className="save-disk-label"
                style={{ marginBottom: "8px" }}
              >
                الحقل المصدر
                <select
                  className="save-disk-input"
                  value={selectedWorkflowStep.sourceField ?? ""}
                  onChange={(event) =>
                    handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                      sourceField: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">بدون</option>
                  {fieldOptions.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label} ({field.key})
                    </option>
                  ))}
                </select>
              </label>
              <label className="save-disk-label">
                الحقل الهدف
                <select
                  className="save-disk-input"
                  value={selectedWorkflowStep.targetField ?? ""}
                  onChange={(event) =>
                    handleWorkflowStepChange(selectedWorkflowStep.stepId, {
                      targetField: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">بدون</option>
                  {fieldOptions.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label} ({field.key})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  handleMoveWorkflowStep(selectedWorkflowStep.stepId, "up")
                }
                disabled={
                  workflowSteps[0]?.stepId === selectedWorkflowStep.stepId
                }
              >
                تحريك لأعلى
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  handleMoveWorkflowStep(selectedWorkflowStep.stepId, "down")
                }
                disabled={
                  workflowSteps[workflowSteps.length - 1]?.stepId ===
                  selectedWorkflowStep.stepId
                }
              >
                تحريك لأسفل
              </button>
            </div>

            <button
              type="button"
              className="secondary-action"
              onClick={() =>
                handleInsertWorkflowStepAfter(selectedWorkflowStep.stepId)
              }
            >
              إرفاق خطوة بعد هذه الخطوة
            </button>

            {selectedWorkflowStep.kind === "custom" && (
              <button
                type="button"
                onClick={() =>
                  handleRemoveWorkflowStep(selectedWorkflowStep.stepId)
                }
                style={{
                  border: "none",
                  borderRadius: "8px",
                  background: "#fee2e2",
                  color: "#b91c1c",
                  padding: "9px 12px",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                حذف الخطوة المخصصة
              </button>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--population-muted)", margin: 0 }}>
            اختر خطوة من الخريطة لتعديلها.
          </p>
        )}
      </aside>
    </div>
  );
}
