import { AlertTriangle } from "lucide-react";

import type { AliasOverlapWarning } from "./mappingSettingsConfig";

/**
 * Surfaces alias-overlap conflicts (Task 2): the same alias string configured under two
 * different target fields (e.g. a stage-classification alias that also appears in a
 * level-one/level-two result column's alias list). This never auto-repairs the config — it only
 * warns, naming both fields, so an admin can decide which list the alias actually belongs to.
 */
export function AliasOverlapWarningBanner({
  warnings,
}: {
  warnings: AliasOverlapWarning[];
}) {
  if (warnings.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        border: "1px solid #fbbf24",
        background: "#fffbeb",
        borderRadius: "10px",
        padding: "12px 14px",
        marginBottom: "16px",
      }}
    >
      <strong
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          color: "#92400e",
          fontSize: "13px",
        }}
      >
        <AlertTriangle size={16} aria-hidden />
        تعارض في التسميات ({warnings.length})
      </strong>
      <p style={{ margin: 0, fontSize: "12px", color: "#78350f" }}>
        نفس التسمية موجودة ضمن أكثر من حقل، مما قد يسبب تصنيفاً خاطئاً للبيانات. راجع القوائم
        التالية وأزل التسمية من الحقل غير الصحيح — لن يتم إصلاح ذلك تلقائياً.
      </p>
      <ul style={{ margin: 0, paddingInlineStart: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {warnings.map((warning) => (
          <li key={warning.alias} style={{ fontSize: "12px", color: "#78350f" }}>
            التسمية &quot;{warning.alias}&quot; مستخدمة في كل من:{" "}
            {warning.fields.map((field) => field.label).join("، ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
