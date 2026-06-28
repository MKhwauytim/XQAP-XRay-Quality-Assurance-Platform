import type { Element, ElementStyle } from "../../../../../data/reportDesigner/reportTypes";

interface InspectorProps {
  element: Element | null;
  onUpdate: (updated: Element) => void;
}

function updateStyle(el: Element, patch: Partial<ElementStyle>): Element {
  return { ...el, style: { ...el.style, ...patch } };
}

export default function Inspector({ element, onUpdate }: InspectorProps) {
  if (!element) return null;

  const s = element.style;
  const cfg = element.config;

  function num(val: number | undefined): string {
    return val != null ? String(val) : "";
  }

  function parseNum(v: string): number | undefined {
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  }

  function parseNumRequired(v: string, fallback: number): number {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  return (
    <div className="rd-inspector" dir="rtl">
      <div className="rd-inspector-section">
        <p className="rd-inspector-heading">العنصر</p>

        {/* Name */}
        <div className="rd-inspector-field">
          <label className="rd-inspector-label">الاسم</label>
          <input
            className="rd-inspector-input"
            type="text"
            value={element.name}
            onChange={(e) => onUpdate({ ...element, name: e.target.value })}
          />
        </div>
      </div>

      {/* ── Geometry ── */}
      <div className="rd-inspector-section">
        <p className="rd-inspector-heading">الموضع والحجم</p>
        <div className="rd-inspector-grid4">
          {(
            [
              { label: "س", key: "x" as const },
              { label: "ص", key: "y" as const },
              { label: "عرض", key: "w" as const },
              { label: "ارتفاع", key: "h" as const },
            ] as Array<{ label: string; key: "x" | "y" | "w" | "h" }>
          ).map(({ label, key }) => (
            <div key={key} className="rd-inspector-field">
              <label className="rd-inspector-label">{label}</label>
              <input
                className="rd-inspector-input rd-inspector-input--num"
                type="number"
                value={element[key]}
                onChange={(e) =>
                  onUpdate({ ...element, [key]: parseNumRequired(e.target.value, element[key]) })
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Style ── */}
      <div className="rd-inspector-section">
        <p className="rd-inspector-heading">المظهر</p>

        <div className="rd-inspector-field">
          <label className="rd-inspector-label">لون الخلفية</label>
          <div className="rd-inspector-color-row">
            <input
              type="color"
              className="rd-inspector-color"
              value={s.fill ?? "#ffffff"}
              onChange={(e) => onUpdate(updateStyle(element, { fill: e.target.value }))}
            />
            <input
              className="rd-inspector-input"
              type="text"
              value={s.fill ?? ""}
              placeholder="#ffffff"
              onChange={(e) => onUpdate(updateStyle(element, { fill: e.target.value || undefined }))}
            />
          </div>
        </div>

        <div className="rd-inspector-field">
          <label className="rd-inspector-label">لون الحدود</label>
          <div className="rd-inspector-color-row">
            <input
              type="color"
              className="rd-inspector-color"
              value={s.borderColor ?? "#000000"}
              onChange={(e) => onUpdate(updateStyle(element, { borderColor: e.target.value }))}
            />
            <input
              className="rd-inspector-input"
              type="text"
              value={s.borderColor ?? ""}
              placeholder="#000000"
              onChange={(e) =>
                onUpdate(updateStyle(element, { borderColor: e.target.value || undefined }))
              }
            />
          </div>
        </div>

        <div className="rd-inspector-field">
          <label className="rd-inspector-label">سمك الحدود</label>
          <input
            className="rd-inspector-input rd-inspector-input--num"
            type="number"
            min={0}
            value={num(s.borderWidth)}
            placeholder="0"
            onChange={(e) =>
              onUpdate(updateStyle(element, { borderWidth: parseNum(e.target.value) }))
            }
          />
        </div>

        <div className="rd-inspector-field">
          <label className="rd-inspector-label">لون النص</label>
          <div className="rd-inspector-color-row">
            <input
              type="color"
              className="rd-inspector-color"
              value={s.color ?? "#000000"}
              onChange={(e) => onUpdate(updateStyle(element, { color: e.target.value }))}
            />
            <input
              className="rd-inspector-input"
              type="text"
              value={s.color ?? ""}
              placeholder="#000000"
              onChange={(e) =>
                onUpdate(updateStyle(element, { color: e.target.value || undefined }))
              }
            />
          </div>
        </div>

        <div className="rd-inspector-grid2">
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">حجم الخط</label>
            <input
              className="rd-inspector-input rd-inspector-input--num"
              type="number"
              min={6}
              max={144}
              value={num(s.fontSize)}
              placeholder="14"
              onChange={(e) =>
                onUpdate(updateStyle(element, { fontSize: parseNum(e.target.value) }))
              }
            />
          </div>
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">وزن الخط</label>
            <input
              className="rd-inspector-input rd-inspector-input--num"
              type="number"
              min={100}
              max={900}
              step={100}
              value={num(s.fontWeight)}
              placeholder="400"
              onChange={(e) =>
                onUpdate(updateStyle(element, { fontWeight: parseNum(e.target.value) }))
              }
            />
          </div>
        </div>

        <div className="rd-inspector-grid2">
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">حشوة</label>
            <input
              className="rd-inspector-input rd-inspector-input--num"
              type="number"
              min={0}
              value={num(s.padding)}
              placeholder="0"
              onChange={(e) =>
                onUpdate(updateStyle(element, { padding: parseNum(e.target.value) }))
              }
            />
          </div>
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">شفافية (0–1)</label>
            <input
              className="rd-inspector-input rd-inspector-input--num"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={num(s.opacity)}
              placeholder="1"
              onChange={(e) =>
                onUpdate(updateStyle(element, { opacity: parseNum(e.target.value) }))
              }
            />
          </div>
        </div>

        <div className="rd-inspector-field">
          <label className="rd-inspector-label">محاذاة النص</label>
          <select
            className="rd-inspector-select"
            value={s.textAlign ?? "right"}
            onChange={(e) =>
              onUpdate(
                updateStyle(element, {
                  textAlign: e.target.value as "right" | "center" | "left",
                })
              )
            }
          >
            <option value="right">يمين</option>
            <option value="center">وسط</option>
            <option value="left">يسار</option>
          </select>
        </div>
      </div>

      {/* ── Type-specific content ── */}
      <div className="rd-inspector-section">
        <p className="rd-inspector-heading">المحتوى</p>

        {cfg.kind === "text" && (
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">النص</label>
            <textarea
              className="rd-inspector-textarea"
              rows={4}
              value={cfg.text}
              onChange={(e) =>
                onUpdate({ ...element, config: { ...cfg, text: e.target.value } })
              }
            />
          </div>
        )}

        {cfg.kind === "shape" && (
          <div className="rd-inspector-field">
            <label className="rd-inspector-label">نوع الشكل</label>
            <select
              className="rd-inspector-select"
              value={cfg.shape}
              onChange={(e) =>
                onUpdate({
                  ...element,
                  config: {
                    ...cfg,
                    shape: e.target.value as "rect" | "line" | "ellipse" | "divider",
                  },
                })
              }
            >
              <option value="rect">مستطيل</option>
              <option value="line">خط</option>
              <option value="ellipse">بيضاوي</option>
              <option value="divider">فاصل</option>
            </select>
          </div>
        )}

        {cfg.kind === "image" && (
          <p className="rd-inspector-placeholder">
            صورة — لا يمكن تغييرها من هنا.
          </p>
        )}

        {(cfg.kind === "table" || cfg.kind === "chart" || cfg.kind === "kpi") && (
          <p className="rd-inspector-placeholder">
            سيتم الدعم في مرحلة لاحقة.
          </p>
        )}
      </div>
    </div>
  );
}
