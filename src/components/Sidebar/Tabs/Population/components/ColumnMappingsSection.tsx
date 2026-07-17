import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";

import type {
  MappingTemplate,
  PopulationConfig,
} from "../../../../../data/population/populationConfig";

export type PendingFieldRemoval = {
  kind: "system" | "custom";
  key: string;
};

type ColumnMappingsSectionProps = {
  config: PopulationConfig;
  template: MappingTemplate;
  newFieldName: string;
  newFieldLabel: string;
  setNewFieldName: Dispatch<SetStateAction<string>>;
  setNewFieldLabel: Dispatch<SetStateAction<string>>;
  setPendingRemoval: Dispatch<SetStateAction<PendingFieldRemoval | null>>;
  handleToggleSystemFieldRequired: (key: string) => void;
  handleMappingChange: (fieldKey: string, value: string) => void;
  handleBiMappingChange: (fieldKey: string, value: string) => void;
  handleAddCustomField: () => void;
};

export function ColumnMappingsSection({
  config,
  template,
  newFieldName,
  newFieldLabel,
  setNewFieldName,
  setNewFieldLabel,
  setPendingRemoval,
  handleToggleSystemFieldRequired,
  handleMappingChange,
  handleBiMappingChange,
  handleAddCustomField,
}: ColumnMappingsSectionProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
        اربط كل حقل بأسماء الأعمدة المتوقعة في ملفات Excel لكل مصدر بيانات على
        حدة. افصل بين التسميات بفواصل (،). عمود BI يُطبَّق على ملف BI فقط، بينما
        عمود المخاطر يُطبَّق على ملف بيانات المخاطر.
      </p>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 1fr 36px",
          gap: "8px",
          alignItems: "center",
          padding: "6px 8px",
          background: "var(--population-bg-card)",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: "700",
          color: "var(--population-muted)",
        }}
      >
        <span>الحقل</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#ef4444",
              display: "inline-block",
            }}
          />
          أعمدة ملف المخاطر
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#3b82f6",
              display: "inline-block",
            }}
          />
          أعمدة ملف BI
        </span>
        <span />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {config.systemFields.map((field) => (
          <div
            key={field.key}
            style={{
              display: "grid",
              gridTemplateColumns: "220px 1fr 1fr 36px",
              gap: "8px",
              alignItems: "center",
            }}
          >
            {/* Field label */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "2px" }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "var(--population-text)",
                }}
              >
                {field.labelAr}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--population-muted)",
                  fontFamily: "monospace",
                }}
              >
                {field.key}
              </span>
              <button
                type="button"
                onClick={() => handleToggleSystemFieldRequired(field.key)}
                title={
                  field.isRequired
                    ? "انقر لإلغاء الإلزامية"
                    : "انقر لجعله إلزامياً"
                }
                style={{
                  fontSize: "10px",
                  fontWeight: "700",
                  padding: "1px 6px",
                  border: "none",
                  borderRadius: "20px",
                  cursor: "pointer",
                  width: "fit-content",
                  background: field.isRequired ? "#fee2e2" : "#f1f5f9",
                  color: field.isRequired
                    ? "#b91c1c"
                    : "var(--population-muted)",
                  transition: "all 150ms",
                }}
              >
                {field.isRequired ? "● إلزامي" : "○ اختياري"}
              </button>
            </div>
            {/* Risk column aliases */}
            <input
              type="text"
              className="save-disk-input"
              placeholder="أسماء الأعمدة في ملف المخاطر..."
              value={(template.columnMappings[field.key] || []).join(", ")}
              onChange={(e) => handleMappingChange(field.key, e.target.value)}
              style={{ borderColor: "#fca5a5" }}
            />
            {/* BI column aliases */}
            <input
              type="text"
              className="save-disk-input"
              placeholder="أسماء الأعمدة في ملف BI... (اتركه فارغاً لاستخدام نفس أعمدة المخاطر)"
              value={((template.biColumnMappings ?? {})[field.key] || []).join(
                ", ",
              )}
              onChange={(e) => handleBiMappingChange(field.key, e.target.value)}
              style={{ borderColor: "#93c5fd" }}
            />
            <button
              type="button"
              onClick={() =>
                setPendingRemoval({ kind: "system", key: field.key })
              }
              title="إزالة هذا الحقل من القائمة"
              style={{
                background: "#f8fafc",
                color: "var(--population-muted)",
                border: "1px solid var(--population-border)",
                borderRadius: "8px",
                padding: "0",
                cursor: "pointer",
                height: "36px",
                width: "36px",
                fontSize: "14px",
                transition: "all 150ms",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#fee2e2";
                (e.currentTarget as HTMLButtonElement).style.color = "#b91c1c";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#f8fafc";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--population-muted)";
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {config.customFields.map((field) => (
          <div
            key={field.key}
            style={{
              display: "grid",
              gridTemplateColumns: "220px 1fr 1fr 36px",
              gap: "8px",
              alignItems: "center",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "2px" }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "var(--population-text)",
                }}
              >
                {field.labelAr}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--population-muted)",
                  fontFamily: "monospace",
                }}
              >
                {field.key}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--population-success)",
                  fontWeight: "600",
                }}
              >
                حقل مخصص
              </span>
            </div>
            <input
              type="text"
              className="save-disk-input"
              placeholder="أعمدة ملف المخاطر..."
              value={(template.columnMappings[field.key] || []).join(", ")}
              onChange={(e) => handleMappingChange(field.key, e.target.value)}
              style={{ borderColor: "#fca5a5" }}
            />
            <input
              type="text"
              className="save-disk-input"
              placeholder="أعمدة ملف BI..."
              value={((template.biColumnMappings ?? {})[field.key] || []).join(
                ", ",
              )}
              onChange={(e) => handleBiMappingChange(field.key, e.target.value)}
              style={{ borderColor: "#93c5fd" }}
            />
                    <button
                      type="button"
                      onClick={() =>
                        setPendingRemoval({ kind: "custom", key: field.key })
                      }
                      aria-label={`حذف الحقل المخصص ${field.labelAr}`}
              style={{
                background: "var(--population-error, #f44336)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "0",
                cursor: "pointer",
                height: "36px",
                width: "36px",
                fontSize: "14px",
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add Custom Field Form */}
      <div
        style={{
          borderTop: "1px dashed var(--population-border)",
          paddingTop: "16px",
          marginTop: "16px",
        }}
      >
        <h4
          style={{
            fontSize: "14px",
            fontWeight: "bold",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden /> إضافة حقل مخصص جديد
        </h4>
        <div style={{ display: "flex", gap: "10px" }}>
          <label className="save-disk-label" style={{ flex: 1 }}>
            اسم الكود (لاتيني - e.g. inspectionLocation)
            <input
              type="text"
              className="save-disk-input"
              placeholder="inspectionLocation"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
            />
          </label>
          <label className="save-disk-label" style={{ flex: 1 }}>
            الاسم باللغة العربية (e.g. موقع التفتيش)
            <input
              type="text"
              className="save-disk-input"
              placeholder="موقع التفتيش"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary-action"
            style={{ alignSelf: "flex-end", height: "36px" }}
            onClick={handleAddCustomField}
          >
            إضافة الحقل
          </button>
        </div>
      </div>
    </div>
  );
}
