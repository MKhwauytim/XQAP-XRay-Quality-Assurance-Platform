import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  description: ReactNode;
  isApprove: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
};

export default function ReviewModal({ title, description, isApprove, onClose, onConfirm }: Props) {
  const [notes, setNotes] = useState("");

  return (
    <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
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
          <button type="button" className="ew-btn-secondary" onClick={onClose}>إلغاء</button>
          <button
            type="button"
            className={isApprove ? "ew-btn-primary" : "ew-btn-deny"}
            onClick={() => onConfirm(notes)}
          >
            {isApprove ? "تأكيد الموافقة" : "تأكيد الرفض"}
          </button>
        </div>
      </div>
    </div>
  );
}
