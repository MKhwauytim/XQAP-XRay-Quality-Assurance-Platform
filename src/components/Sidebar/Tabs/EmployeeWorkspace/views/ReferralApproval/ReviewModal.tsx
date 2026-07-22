import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { useFocusTrap } from "../../../../../../hooks/useFocusTrap";
import { useLabels } from "../../../../../../data/labels/useLabels";

type Props = {
  title: string;
  description: ReactNode;
  isApprove: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void>;
};

export default function ReviewModal({ title, description, isApprove, onClose, onConfirm }: Props) {
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const L = useLabels();
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  async function handleConfirm(): Promise<void> {
    // The ref closes the same-render double-click window before React commits
    // the disabled state, so slow filesystem writes cannot append twice.
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await onConfirm(notes);
    } catch {
      // The parent normally converts domain failures to a visible status. Keep
      // the dialog usable if an unexpected callback error escapes instead.
      runningRef.current = false;
      setRunning(false);
    }
  }

  return (
    <div ref={dialogRef} className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </div>
        <div className="ew-replace-reason">
          <p style={{ margin: 0, color: "#475569" }}>{description}</p>
          <label className="ew-field-label" htmlFor="review-notes" style={{ marginTop: 12 }}>
            ملاحظة (اختياري)
          </label>
          <textarea
            id="review-notes"
            className="ew-input ew-textarea"
            rows={2}
            placeholder="أضف ملاحظة للموظف..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
          <button type="button" className="ew-btn-secondary" onClick={onClose} disabled={running}>إلغاء</button>
          <button
            type="button"
            className={isApprove ? "ew-btn-primary" : "ew-btn-deny"}
            onClick={() => void handleConfirm()}
            disabled={running}
          >
            {running ? L.referral_review_saving : isApprove ? "تأكيد الموافقة" : "تأكيد الرفض"}
          </button>
        </div>
      </div>
    </div>
  );
}
